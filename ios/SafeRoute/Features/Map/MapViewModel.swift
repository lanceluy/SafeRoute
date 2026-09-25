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

    /// Anything wider than this isn't a pedestrian's map.
    nonisolated static let maxSpanDegrees = 0.45
    /// The server rejects bounding boxes wider than this; padded queries are clamped to it.
    nonisolated static let maxQuerySpanDegrees = 0.5

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
    /// The padded box of the last complete (untruncated) load. Moving the map inside it — e.g.
    /// the camera following a walking user — needs no new request: hazards in it stay current
    /// through the WebSocket.
    private var loadedBox: LoadedBox?
    private var loadTask: Task<Void, Never>?
    /// Bumped on sign-out so responses to the previous session's requests are dropped.
    private var generation = 0
    /// Per-hazard sequence of the last live (WebSocket) update, so a snapshot that was already in
    /// flight can't remove a hazard that appeared or changed after it was taken.
    private(set) var liveSequence = 0
    private var lastLiveUpdate: [UUID: Int] = [:]

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

    struct LoadedBox: Equatable {
        let minLat: Double, minLon: Double, maxLat: Double, maxLon: Double
        let statuses: Set<HazardStatus>

        func covers(_ region: MKCoordinateRegion, statuses wanted: Set<HazardStatus>) -> Bool {
            guard wanted == statuses else { return false }
            let halfLat = region.span.latitudeDelta / 2, halfLon = region.span.longitudeDelta / 2
            return region.center.latitude - halfLat >= minLat && region.center.latitude + halfLat <= maxLat
                && region.center.longitude - halfLon >= minLon && region.center.longitude + halfLon <= maxLon
        }
    }

    func regionChanged(_ region: MKCoordinateRegion) {
        lastRegion = region
        if loadState == .loaded, loadedBox?.covers(region, statuses: filters.statuses) == true { return }
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
        let generation = self.generation
        let sequenceAtStart = liveSequence
        // Slight padding so panning a little doesn't immediately reveal empty edges, clamped to
        // the server's limit.
        let latSpan = min(region.span.latitudeDelta * 1.2, Self.maxQuerySpanDegrees)
        let lonSpan = min(region.span.longitudeDelta * 1.2, Self.maxQuerySpanDegrees)
        let box = (minLat: region.center.latitude - latSpan / 2, minLon: region.center.longitude - lonSpan / 2,
                   maxLat: region.center.latitude + latSpan / 2, maxLon: region.center.longitude + lonSpan / 2)
        let statuses = filters.statuses
        do {
            let (fresh, response) = try await APIClient.shared.sendWithResponse(.inBbox(
                minLat: box.minLat, minLon: box.minLon, maxLat: box.maxLat, maxLon: box.maxLon,
                statuses: statuses), as: [Hazard].self)
            guard !Task.isCancelled, generation == self.generation else { return }
            for hazard in fresh { upsert(hazard) }
            // Only a complete snapshot says anything about hazards it doesn't contain.
            if response.value(forHTTPHeaderField: "X-Result-Truncated") != "true" {
                reconcile(snapshot: fresh, box: box, statuses: statuses, sequenceAtStart: sequenceAtStart)
                loadedBox = LoadedBox(minLat: box.minLat, minLon: box.minLon, maxLat: box.maxLat, maxLon: box.maxLon,
                                      statuses: statuses)
            } else {
                loadedBox = nil
            }
            loadState = .loaded
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, generation == self.generation else { return }
            loadedBox = nil
            loadState = .failed("Couldn't load nearby hazards.")
        }
    }

    /// Removes cached hazards the server no longer returns for exactly this box and status set
    /// (resolved, expired or changed while we weren't listening).
    func reconcile(snapshot: [Hazard],
                           box: (minLat: Double, minLon: Double, maxLat: Double, maxLon: Double),
                           statuses: Set<HazardStatus>, sequenceAtStart: Int) {
        let returned = Set(snapshot.map(\.id))
        let stale = hazards.values.filter { hazard in
            !returned.contains(hazard.id)
                && statuses.contains(hazard.status)
                && (box.minLat...box.maxLat).contains(hazard.latitude)
                && (box.minLon...box.maxLon).contains(hazard.longitude)
                && (lastLiveUpdate[hazard.id] ?? 0) <= sequenceAtStart
        }.map(\.id)
        guard !stale.isEmpty else { return }
        for id in stale { hazards[id] = nil }
        // A hazard on the walker's route must not silently vanish from guidance: its absence may
        // only mean it left the selected status filter. Look up its real state.
        if let session = navigation {
            let onRoute = Set(session.routeHazards.map(\.id))
            for id in stale where onRoute.contains(id) {
                Task {
                    await fetchAndUpsert(id)
                    syncNavigationHazards()
                }
            }
        }
    }

    func fetchAndUpsert(_ hazardId: UUID) async {
        let generation = self.generation
        if let detail = try? await APIClient.shared.send(.hazard(id: hazardId), as: HazardDetail.self),
           generation == self.generation {
            upsert(detail.hazard)
        }
    }

    /// Stores a snapshot unless a newer version of the hazard is already known.
    func upsert(_ hazard: Hazard) {
        if let existing = hazards[hazard.id], (existing.version ?? 0) > (hazard.version ?? 0) { return }
        hazards[hazard.id] = hazard
    }

    // MARK: Real-time

    /// Patch local state immediately from a WebSocket frame.
    func apply(_ frame: HazardEventFrame) {
        liveSequence += 1
        lastLiveUpdate[frame.hazardId] = liveSequence
        if var existing = hazards[frame.hazardId] {
            // Frames can arrive out of order (two topics, reconnects): never go back in time.
            if let known = existing.version, let incoming = frame.version, incoming < known { return }
            existing.status = frame.status
            existing.severity = frame.severity
            existing.confirmationCount = frame.confirmationCount
            existing.disputeCount = frame.disputeCount
            existing.latitude = frame.latitude
            existing.longitude = frame.longitude
            existing.type = frame.hazardType
            existing.updatedAt = frame.occurredAt ?? Date()
            existing.version = frame.version ?? existing.version
            hazards[frame.hazardId] = existing
        } else {
            hazards[frame.hazardId] = Hazard(
                id: frame.hazardId, type: frame.hazardType, latitude: frame.latitude, longitude: frame.longitude,
                description: nil, photoUrl: nil, status: frame.status, severity: frame.severity, severityAnswer: nil,
                confirmationCount: frame.confirmationCount, disputeCount: frame.disputeCount, confidence: nil,
                reporterId: nil, createdAt: frame.occurredAt ?? Date(), updatedAt: frame.occurredAt ?? Date(),
                lastConfirmedAt: nil, expiresAt: nil, resolvedAt: nil, version: frame.version)
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
        // Everything the assessment saw along the route, so the map and guidance agree with the card.
        for hazard in plan.assessedHazards { upsert(hazard) }
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
        SimulatedWalk.started(from: userLocation, route: option.coordinates)
        onNavigationChange?(true)
        command = CommandRequest(command: .followUser)
    }

    func endNavigation() {
        guard let session = navigation else { return }
        session.stop()
        navigation = nil
        SimulatedWalk.ended(at: userLocation)
        onNavigationChange?(false)
        if plan != nil { command = CommandRequest(command: .showRoute) }
    }

    /// Off route: plan again from here to the same destination (still avoiding hazards).
    func reroute() async {
        guard let plan, let here = userLocation, !isRerouting else { return }
        isRerouting = true
        defer { isRerouting = false }
        guard let fresh = try? await RouteAvoidanceService.shared.plan(from: here, to: plan.destination,
                                                                       destinationName: plan.destinationName,
                                                                       destinationItem: plan.destinationItem) else { return }
        let voice = navigation?.voiceEnabled ?? true
        navigation?.stop()
        self.plan = fresh
        for hazard in fresh.assessedHazards { upsert(hazard) }
        useSaferRoute = fresh.safer != nil
        publishActiveRoute()
        guard let option = activeRoute else { return }
        let session = NavigationSession(plan: fresh, option: option, knownHazards: Array(hazards.values))
        session.voiceEnabled = voice
        navigation = session
        session.start()
        SimulatedWalk.started(from: userLocation, route: option.coordinates)
        command = CommandRequest(command: .followUser)
    }

    /// Keeps the session's hazard list in sync with live WebSocket updates.
    func syncNavigationHazards() {
        navigation?.refreshHazards(Array(hazards.values))
    }

    /// After a gap in live updates (reconnect), re-assesses the whole active route so guidance
    /// converges on the server's state, including hazards resolved while disconnected.
    func reassessActiveRoute() async {
        guard let session = navigation, let route = activeRoute else { return }
        let generation = self.generation
        let points = RouteAvoidanceService.downsample(route.coordinates, maxPoints: 4000)
        guard let response = try? await APIClient.shared.send(
                .alongRoute([points], corridorMeters: RoutingSettings.corridorMeters + 20), as: RouteHazardsResponse.self),
              response.complete, generation == self.generation, navigation === session else { return }
        for hazard in response.hazards { upsert(hazard) }
        session.replaceHazards(withCompleteAssessment: response.hazards)
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
        generation += 1
        loadTask?.cancel()
        endNavigation()
        hazards = [:]
        lastLiveUpdate = [:]
        loadedBox = nil
        plan = nil
        latestAlert = nil
        selectedHazardId = nil
        loadState = .idle
    }
}
