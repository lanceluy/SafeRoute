import UIKit
import UserNotifications

/// UIKit hooks SwiftUI doesn't offer: the APNs device token, notification taps, and relaunches
/// for significant location changes. Wired up with `@UIApplicationDelegateAdaptor` in SafeRouteApp.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // After a relaunch for a location event (`.location` launch key) monitoring must be
        // restarted for events to keep arriving. No permission prompts here: the user opts in
        // from Profile → Notifications.
        if PushRegistration.shared.isEnabled {
            LocationManager.shared.setBackgroundAlerts(enabled: true)
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushRegistration.shared.didRegister(deviceToken: deviceToken)
    }

    /// Expected in builds without the Push Notifications entitlement (free Apple Developer accounts).
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushRegistration.shared.didFailToRegister(error)
    }

    /// In the foreground the in-app alert banner already shows the hazard, so the system
    /// notification only goes to Notification Center instead of stacking a second banner.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.list]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        guard let idString = response.notification.request.content.userInfo["hazardId"] as? String,
              let hazardId = UUID(uuidString: idString) else { return }
        await MainActor.run {
            NotificationCenter.default.post(name: .openHazardFromNotification, object: hazardId)
        }
    }
}
