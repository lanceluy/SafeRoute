import Foundation
import CoreLocation
import UIKit
import UserNotifications

extension Notification.Name {
    /// Posted when the user taps a hazard notification; `object` is the hazard's UUID.
    static let openHazardFromNotification = Notification.Name("SafeRoute.openHazardFromNotification")
}

/// Background hazard alerts: registers this device's APNs token with the backend and reports
/// significant location changes, so the server can push alerts while the app is closed.
///
/// Opt-in per person (Profile → Notifications) and switched off on sign-out. Push delivery needs
/// the Push Notifications entitlement, which needs a paid Apple Developer account (see project.yml);
/// without it registration fails and `unavailableReason` says so.
@MainActor
final class PushRegistration: ObservableObject {
    static let shared = PushRegistration()

    /// Also read by `@AppStorage` in the settings screen.
    static let enabledKey = "saferoute.backgroundAlerts"
    private let tokenKey = "saferoute.apnsDeviceToken"
    /// Uploads are throttled: significant-change updates are ~500 m apart anyway, but foreground
    /// updates arrive every few meters.
    private let minimumUploadDistance: CLLocationDistance = 200
    private let minimumUploadInterval: TimeInterval = 15 * 60

    @Published private(set) var unavailableReason: String?

    private let defaults: UserDefaults
    private var lastUpload: CLLocation?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var isEnabled: Bool { defaults.bool(forKey: Self.enabledKey) }
    var deviceToken: String? { defaults.string(forKey: tokenKey) }

    /// Asks for notification and "Always" location permission, then starts background alerts.
    /// Returns false (and leaves alerts off) if notifications are not allowed.
    func enable() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
        guard granted else {
            unavailableReason = "Notifications are turned off for SafeRoute. Turn them on in Settings to get background alerts."
            defaults.set(false, forKey: Self.enabledKey)
            return false
        }
        defaults.set(true, forKey: Self.enabledKey)
        LocationManager.shared.requestAlwaysPermission()
        start()
        return true
    }

    func disable() {
        defaults.set(false, forKey: Self.enabledKey)
        LocationManager.shared.setBackgroundAlerts(enabled: false)
        if let token = deviceToken {
            Task { try? await APIClient.shared.send(.unregisterPushDevice(token: token)) }
        }
    }

    /// On sign-in / app launch with a signed-in user: re-register if the user opted in.
    func sessionStarted() {
        guard isEnabled else { return }
        start()
    }

    /// Consent belongs to the person, not the phone: the next account starts with alerts off.
    /// `accessToken` is the signed-out account's token, captured before the Keychain is cleared.
    func sessionEnded(accessToken: String?) {
        defaults.set(false, forKey: Self.enabledKey)
        LocationManager.shared.setBackgroundAlerts(enabled: false)
        lastUpload = nil
        if let token = deviceToken, let accessToken {
            Task { try? await APIClient.shared.send(.unregisterPushDevice(token: token).authorized(with: accessToken)) }
        }
    }

    // MARK: Called by AppDelegate / LocationManager

    func didRegister(deviceToken data: Data) {
        let token = data.map { String(format: "%02x", $0) }.joined()
        defaults.set(token, forKey: tokenKey)
        unavailableReason = nil
        guard isEnabled, KeychainService.shared.readRefreshToken() != nil else { return }
        Task {
            do {
                try await APIClient.shared.send(.registerPushDevice(token: token))
                // The server keeps no location until the first upload.
                if let location = LocationManager.shared.currentFix { await upload(location, force: true) }
            } catch {
                unavailableReason = "Couldn't register for background alerts: \(error.localizedDescription)"
            }
        }
    }

    func didFailToRegister(_ error: Error) {
        unavailableReason = "Push notifications aren't set up in this build of SafeRoute, so alerts only arrive while the app is open."
    }

    func locationChanged(_ location: CLLocation) {
        guard isEnabled, deviceToken != nil else { return }
        Task { await upload(location, force: false) }
    }

    // MARK: Private

    private func start() {
        UIApplication.shared.registerForRemoteNotifications()
        LocationManager.shared.setBackgroundAlerts(enabled: true)
    }

    private func upload(_ location: CLLocation, force: Bool) async {
        guard let token = deviceToken, KeychainService.shared.readRefreshToken() != nil else { return }
        if !force, let last = lastUpload,
           location.distance(from: last) < minimumUploadDistance,
           location.timestamp.timeIntervalSince(last.timestamp) < minimumUploadInterval {
            return
        }
        lastUpload = location
        // In the background the app gets a few seconds per location event; ask for enough to finish.
        let taskId = UIApplication.shared.beginBackgroundTask(withName: "SafeRoute.locationUpload")
        defer { if taskId != .invalid { UIApplication.shared.endBackgroundTask(taskId) } }
        do {
            try await APIClient.shared.send(.updatePushDeviceLocation(token: token, location.coordinate))
        } catch APIError.server(let status, _, _) where status == 404 {
            // The server forgot this device (e.g. APNs reported the token invalid): register again.
            lastUpload = nil
            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            lastUpload = nil // retry on the next location event
        }
    }
}
