import Foundation
import CoreLocation
import MapKit

/// App-scoped map state. Lives in AppState (not the view) so WebSocket frames keep patching it
/// while the user is on another tab.
@MainActor
final class MapViewModel: ObservableObject {
    enum MapCommand: Equatable {
        case recenterOnUser
        case focus(CLLocationCoordinate2D)
        case showRoute
        /// Navigation camera: follow the user with heading, zoomed in and tilted.
        case followUser

        static func == (lhs: MapCommand, rhs: MapCommand) -> Bool {
            switch (lhs, rhs) {
            case (.recenterOnUser, .recenterOnUser), (.showRoute, .showRoute), (.followUser, .followUser): return true
            case let (.focus(a), .focus(b)): return a.latitude == b.latitude && a.longitude == b.longitude
            default: return false
            }
        }
    }

    struct CommandRequest: Equatable {
        let id = UUID()
        let command: MapCommand
    }

    /// Anything wider than this isn't a pedestrian's map; the server also rejects it.
    nonisolated static let maxSpanDegrees = 0.45

    @Published private(set) var hazards: [UUID: Hazard] = [:]
    @Published var filters = MapFilters.load() {
        didSet {
            filters.save()
            if filters.statuses != oldValue.statuses { Task { await refresh() } }
        }
    }
    @Published private(set) var loadState: LoadState = .idle
    @Published private(set) var isZoomedOutTooFar = false
    @Published private(set) var latestAlert: HazardEventFrame?
    @Published var command: CommandRequest?
    /// Hazard shown in the floating preview card (tap a pin → preview → details).
    @Published var selectedHazardId: UUID?

    // Routing
    @Published private(set) var plan: RoutePlan?
    @Published var useSaferRoute = true {
        didSet { publishActiveRoute() }
    }
    /// Active turn-by-turn session (nil when just browsing).
    @Published private(set) var navigation: NavigationSession?
    @Published private(set) var isRerouting = false
    /// AppState hides the tab bar while navigating.
    var onNavigationChange: ((Bool) -> Void)?

    private var lastRegion: MKCoordinateRegion?
    private var loadTask: Task<Void, Never>?

    // MARK: Derived

    var userLocation: CLLocationCoordinate2D? { LocationManager.shared.currentLocation }

    var visibleHazards: [Hazard] {
        hazards.values.filter { hazard in
            guard filters.types.contains(hazard.type), filters.statuses.contains(hazard.status) else { return false }
            if filters.distance != .any, let distance = Format.distance(from: userLocation, to: hazard.coordinate) {
                return distance <= Double(filters.distance.rawValue)
            }
            return true
        }
    }

    /// For the "Hazards nearby" card: active hazards within 1 km, nearest first.
    var nearbyActive: [(hazard: Hazard, distance: Double)] {
        guard let user = userLocation else { return [] }
        return hazards.values
            .filter { $0.status.isActive && filters.types.contains($0.type) }
            .compactMap { h in Format.distance(from: user, to: h.coordinate).map { (h, $0) } }
            .filter { $0.1 <= 1000 }
            .sorted { $0.1 < $1.1 }
    }

    var selectedHazard: Hazard? { selectedHazardId.flatMap { hazards[$0] } }

    var activeRoute: RouteOption? {
        guard let plan else { return nil }
        return useSaferRoute ? (plan.safer ?? plan.original) : plan.original
    }

    // MARK: Loading

    func regionChanged(_ region: MKCoordinateRegion) {
        lastRegion = region
        loadTask?.cancel()
        loadTask = Task { await load(region: region) }
    }

    func refresh() async {
        if let lastRegion {
            await load(region: lastRegion)
        } else if let user = userLocation {
            await load(region: MKCoordinateRegion(center: user, latitudinalMeters: 2000, longitudinalMeters: 2000))
        }
    }

    private func load(region: MKCoordinateRegion) async {
        guard region.span.latitudeDelta <= Self.maxSpanDegrees, region.span.longitudeDelta <= Self.maxSpanDegrees else {
            isZoomedOutTooFar = true
            return
        }
        isZoomedOutTooFar = false
        loadState = .loading
        do {
            // Slight padding so panning a little doesn't immediately reveal empty edges.
            let latPad = region.span.latitudeDelta * 0.1, lonPad = region.span.longitudeDelta * 0.1
            let fresh = try await APIClient.shared.send(.inBbox(
                minLat: region.center.latitude - region.span.latitudeDelta / 2 - latPad,
                minLon: region.center.longitude - region.span.longitudeDelta / 2 - lonPad,
                maxLat: region.center.latitude + region.span.latitudeDelta / 2 + latPad,
                maxLon: region.center.longitude + region.span.longitudeDelta / 2 + lonPad,
                statuses: filters.statuses), as: [Hazard].self)
            guard !Task.isCancelled else { return }
            for hazard in fresh { hazards[hazard.id] = hazard }
            loadState = .loaded
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            loadState = .failed("Couldn't load nearby hazards.")
        }
    }

    func fetchAndUpsert(_ hazardId: UUID) async {
        if let detail = try? await APIClient.shared.send(.hazard(id: hazardId), as: HazardDetail.self) {
            upsert(detail.hazard)
        }
    }

    func upsert(_ hazard: Hazard) {
        hazards[hazard.id] = hazard
    }

    // MARK: Real-time

    /// Patch local state immediately from a WebSocket frame (review §23).
    func apply(_ frame: HazardEventFrame) {
        if var existing = hazards[frame.hazardId] {
            existing.status = frame.status
            existing.severity = frame.severity
            existing.confirmationCount = frame.confirmationCount
            existing.disputeCount = frame.disputeCount
            existing.latitude = frame.latitude
            existing.longitude = frame.longitude
            existing.type = frame.hazardType
            existing.updatedAt = frame.occurredAt ?? Date()
            hazards[frame.hazardId] = existing
        } else {
            hazards[frame.hazardId] = Hazard(
                id: frame.hazardId, type: frame.hazardType, latitude: frame.latitude, longitude: frame.longitude,
                description: nil, photoUrl: nil, status: frame.status, severity: frame.severity, severityAnswer: nil,
                confirmationCount: frame.confirmationCount, disputeCount: frame.disputeCount, confidence: nil,
                reporterId: nil, createdAt: frame.occurredAt ?? Date(), updatedAt: frame.occurredAt ?? Date(),
                lastConfirmedAt: nil, expiresAt: nil, resolvedAt: nil)
        }
    }

    func showAlert(_ frame: HazardEventFrame) {
        latestAlert = frame
        Task {
            try? await Task.sleep(for: .seconds(8))
            if latestAlert?.id == frame.id { latestAlert = nil }
        }
    }

    func dismissAlert() {
        latestAlert = nil
    }

    // MARK: Routing

    func setPlan(_ plan: RoutePlan) {
        self.plan = plan
        useSaferRoute = plan.safer != nil
        publishActiveRoute()
        command = CommandRequest(command: .showRoute)
    }

    func clearRoute() {
        endNavigation()
        plan = nil
        WebSocketClient.shared.updateRoute(nil)
    }

    // MARK: Navigation

    var isNavigating: Bool { navigation != nil }

    func startNavigation() {
        guard let plan, let option = activeRoute else { return }
        navigation?.stop()
        selectedHazardId = nil
        let session = NavigationSession(plan: plan, option: option, knownHazards: Array(hazards.values))
        navigation = session
        session.start()
        onNavigationChange?(true)
        command = CommandRequest(command: .followUser)
    }

    func endNavigation() {
        guard let session = navigation else { return }
        session.stop()
        navigation = nil
        onNavigationChange?(false)
        if plan != nil { command = CommandRequest(command: .showRoute) }
    }

    /// Off route: plan again from here to the same destination (still avoiding hazards).
    func reroute() async {
        guard let plan, let here = userLocation, !isRerouting else { return }
        isRerouting = true
        defer { isRerouting = false }
        guard let fresh = try? await RouteAvoidanceService.shared.plan(from: here, to: plan.destination,
                                                                       destinationName: plan.destinationName) else { return }
        let voice = navigation?.voiceEnabled ?? true
        navigation?.stop()
        self.plan = fresh
        useSaferRoute = fresh.safer != nil
        publishActiveRoute()
        guard let option = activeRoute else { return }
        let session = NavigationSession(plan: fresh, option: option, knownHazards: Array(hazards.values))
        session.voiceEnabled = voice
        navigation = session
        session.start()
        command = CommandRequest(command: .followUser)
    }

    /// Keeps the session's hazard list in sync with live WebSocket updates.
    func syncNavigationHazards() {
        navigation?.refreshHazards(Array(hazards.values))
    }

    /// While navigating, show only what matters: hazards on the route and anything right next to the user.
    var navigationHazards: [Hazard] {
        guard let session = navigation else { return visibleHazards }
        let onRoute = Set(session.routeHazards.map(\.id))
        return hazards.values.filter { hazard in
            guard hazard.status.isActive else { return false }
            if onRoute.contains(hazard.id) { return true }
            if let d = Format.distance(from: userLocation, to: hazard.coordinate) { return d <= 75 }
            return false
        }
    }

    private func publishActiveRoute() {
        WebSocketClient.shared.updateRoute(activeRoute?.coordinates)
    }

    func reset() {
        endNavigation()
        hazards = [:]
        plan = nil
        latestAlert = nil
        selectedHazardId = nil
        loadState = .idle
    }
}
