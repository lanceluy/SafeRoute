import Foundation
import CoreLocation
import Combine

@MainActor
final class LocationManager: NSObject, ObservableObject {
    /// What the app can honestly tell the user about location.
    enum State: Equatable {
        case notDetermined
        /// Permission denied or restricted (user must change it in Settings).
        case denied
        /// Permission granted, but no position yet (e.g. a Simulator with Location set to None).
        case searching
        /// Permission granted, but the device reported it can't determine a position.
        case unavailable
        case available
    }

    static let shared = LocationManager()

    @Published private(set) var currentLocation: CLLocationCoordinate2D?
    /// The latest fix with its accuracy and timestamp; navigation needs both to judge it.
    @Published private(set) var currentFix: CLLocation?
    /// Direction of travel in degrees (nil when not moving / unknown). Used by the navigation camera.
    @Published private(set) var course: CLLocationDirection?
    @Published private(set) var authorizationStatus: CLAuthorizationStatus
    @Published private(set) var state: State = .notDetermined

    /// Fires on meaningful movement so callers (map refresh, WebSocket resubscribe) don't
    /// need to poll `currentLocation` themselves.
    var onSignificantChange: ((CLLocationCoordinate2D) -> Void)?

    private let manager = CLLocationManager()
    private var lastPublishedLocation: CLLocation?
    private let minimumMoveMeters: CLLocationDistance = 25
    private var isUpdating = false

    static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    override private init() {
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
        apply(authorizationStatus)
    }

    func requestPermission() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else {
            apply(manager.authorizationStatus)
        }
    }

    /// Asks for a fresh fix (e.g. when the user taps the locate button).
    func refresh() {
        guard isAuthorized else { return }
        startUpdating()
        manager.requestLocation()
    }

    /// Walking navigation wants frequent, fitness-tuned fixes; normal browsing doesn't.
    func setNavigationMode(_ navigating: Bool) {
        manager.activityType = navigating ? .fitness : .other
        manager.distanceFilter = navigating ? 5 : 10
        if navigating { refresh() }
    }

    var isAuthorized: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }

    private func startUpdating() {
        guard !isUpdating else { return }
        isUpdating = true
        manager.startUpdatingLocation()
    }

    private func apply(_ status: CLAuthorizationStatus) {
        authorizationStatus = status
        switch status {
        case .authorizedWhenInUse, .authorizedAlways:
            if currentLocation == nil { state = .searching }
            startUpdating()
        case .denied, .restricted:
            state = .denied
            isUpdating = false
            manager.stopUpdatingLocation()
        default:
            state = .notDetermined
        }
    }
}

extension LocationManager: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in self.apply(status) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let newest = locations.last else { return }
        Task { @MainActor in
            self.currentLocation = newest.coordinate
            self.currentFix = newest
            if newest.course >= 0 && newest.speed > 0.3 { self.course = newest.course }
            self.state = .available
            if self.lastPublishedLocation == nil || newest.distance(from: self.lastPublishedLocation!) >= self.minimumMoveMeters {
                self.lastPublishedLocation = newest
                self.onSignificantChange?(newest.coordinate)
            }
        }
    }

    /// Previously unhandled: without this the app stayed silent when no position was available.
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        Task { @MainActor in
            switch code {
            case .denied:
                self.state = .denied
            case .locationUnknown:
                // Transient: Core Location keeps trying. Keep any last known position.
                if self.currentLocation == nil { self.state = .unavailable }
            default:
                if self.currentLocation == nil { self.state = .unavailable }
            }
        }
    }
}
