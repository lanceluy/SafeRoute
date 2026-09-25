import Foundation
import MapKit

/// One manoeuvre of a walking leg.
struct WalkingStep: Sendable {
    let instructions: String
    let distance: CLLocationDistance
}

/// One leg of walking directions: MKRoute's geometry and steps in a form tests can construct.
/// @unchecked: MKPolyline isn't annotated Sendable, but these values are never mutated after creation.
struct WalkingLeg: @unchecked Sendable {
    let polyline: MKPolyline
    let distance: CLLocationDistance
    let expectedTravelTime: TimeInterval
    let steps: [WalkingStep]

    init(polyline: MKPolyline, distance: CLLocationDistance, expectedTravelTime: TimeInterval, steps: [WalkingStep]) {
        self.polyline = polyline
        self.distance = distance
        self.expectedTravelTime = expectedTravelTime
        self.steps = steps
    }

    init(route: MKRoute) {
        self.init(polyline: route.polyline, distance: route.distance, expectedTravelTime: route.expectedTravelTime,
                  steps: route.steps.map { WalkingStep(instructions: $0.instructions, distance: $0.distance) })
    }

    var coordinates: [CLLocationCoordinate2D] {
        var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: polyline.pointCount)
        polyline.getCoordinates(&coords, range: NSRange(location: 0, length: polyline.pointCount))
        return coords
    }
}

struct RouteHazard: Identifiable, Hashable, Sendable {
    let hazard: Hazard
    /// Shortest distance from the hazard to the route polyline, in meters.
    let distanceFromPath: Double
    var id: UUID { hazard.id }
}

/// One candidate route. A waypoint detour has two legs; **all** legs are rendered.
struct RouteOption: Sendable {
    let legs: [WalkingLeg]
    let hazards: [RouteHazard]

    var expectedTravelTime: TimeInterval { legs.reduce(0) { $0 + $1.expectedTravelTime } }
    var distance: CLLocationDistance { legs.reduce(0) { $0 + $1.distance } }
    var polylines: [MKPolyline] { legs.map(\.polyline) }
    var coordinates: [CLLocationCoordinate2D] { legs.flatMap(\.coordinates) }

    /// Weighted hazard exposure: high-severity hazards dominate; disputed ones count half. A
    /// transparent heuristic, not a validated safety measure — the card always lists what remains.
    var riskScore: Double {
        hazards.reduce(0) { total, rh in
            let weight: Double = switch rh.hazard.severity {
            case .high: 10
            case .medium: 3
            default: 1
            }
            return total + weight * (rh.hazard.status == .disputed ? 0.5 : 1)
        }
    }

    var hasHighSeverityHazard: Bool { hazards.contains { $0.hazard.severity == .high } }
}

/// Whether the hazard data behind a plan is complete. Only a complete assessment may be shown
/// as "no reported hazards"; anything else says what could not be checked.
enum HazardAssessment: Equatable, Sendable {
    case complete
    /// Checked, but some hazards may be missing (capped result, route leaves the pilot area).
    case incomplete(String)
    /// Hazards could not be checked at all (offline, server error). Directions still work.
    case unavailable(String)

    var isComplete: Bool { self == .complete }

    var notice: String? {
        switch self {
        case .complete: return nil
        case .incomplete(let reason), .unavailable(let reason): return reason
        }
    }
}

/// @unchecked: MKMapItem isn't annotated Sendable, but it is never mutated after creation.
struct RoutePlan: Identifiable, @unchecked Sendable {
    let id = UUID()
    let destinationName: String
    let destination: CLLocationCoordinate2D
    /// The searched place, when there is one. Routing to it (rather than its bare coordinate)
    /// lets MapKit end the walk at the place's pedestrian entrance.
    let destinationItem: MKMapItem?
    /// MapKit's first (recommended) walking route. Not necessarily the fastest candidate.
    let original: RouteOption
    /// A lower-risk alternative, or nil when the original is already clear, nothing better
    /// exists, or the assessment was incomplete (no safety claim is made then).
    let safer: RouteOption?
    let assessment: HazardAssessment
    /// Every hazard the assessment found along any candidate — seeds navigation so guidance
    /// knows everything the comparison card knew.
    let assessedHazards: [Hazard]

    /// Hazards near the original path that the safer route stays clear of — the "why".
    var avoided: [RouteHazard] {
        guard let safer else { return [] }
        let remaining = Set(safer.hazards.map(\.id))
        return original.hazards.filter { !remaining.contains($0.id) }
    }

    var extraTime: TimeInterval {
        guard let safer else { return 0 }
        return max(0, safer.expectedTravelTime - original.expectedTravelTime)
    }
}

enum RouteAvoidanceError: LocalizedError {
    case noRouteFound
    var errorDescription: String? { "No walking route was found to that destination." }
}

/// Where a route ends: a searched place (routes to its entrance) or a bare coordinate.
enum RouteEndpoint {
    case coordinate(CLLocationCoordinate2D)
    case place(MKMapItem)
}

/// Shared routing parameters, from GET /api/meta/routing (see MetaStore).
@MainActor
enum RoutingSettings {
    /// A hazard this close to the path is "on" the route — the same value the server uses for
    /// on-route alerts, so planning, navigation and alerts agree.
    static var corridorMeters: Double = 40
}

/// MapKit has no native "avoid this point" API, so this scores MKDirections' alternates against
/// active hazards near each path and, only if none of them helps, synthesizes waypoint detours on
/// both sides of the worst hazard. Bounded so it can't loop forever or trip MapKit's request
/// throttling.
///
/// Detours are a last resort because they pull walkers off the pedestrian network: a waypoint is
/// an arbitrary coordinate, and MapKit snaps it to the nearest routable segment — in the city,
/// usually a street — so the detour leaves footbridges, underpasses and walkways to reach it.
/// MapKit's own alternates never have that problem.
///
/// Hazards come from the along-route endpoint, which returns every active hazard in the corridor
/// (not a recency-ordered sample) and says when that is incomplete. Detour geometry is assessed
/// with its own request. A failed or incomplete assessment never produces a "safer" claim.
///
/// Main-actor so MapKit objects (MKMapItem, MKRoute — not Sendable) never cross isolation; the
/// slow part, MKDirections, is awaited off the main thread anyway.
@MainActor
struct RouteAvoidanceService {
    typealias Directions = @MainActor (CLLocationCoordinate2D, RouteEndpoint, Bool) async throws -> [WalkingLeg]
    typealias HazardSource = @MainActor ([[CLLocationCoordinate2D]], Double) async throws -> RouteHazardsResponse

    static let shared = RouteAvoidanceService(directions: MapKitDirections.walkingRoutes,
                                              hazardSource: RouteAvoidanceService.hazardsAlongRoutes)

    /// The live hazard source: the backend's along-route query.
    static func hazardsAlongRoutes(_ routes: [[CLLocationCoordinate2D]], corridorMeters: Double) async throws -> RouteHazardsResponse {
        try await APIClient.shared.send(.alongRoute(routes, corridorMeters: corridorMeters), as: RouteHazardsResponse.self)
    }

    let directions: Directions
    let hazardSource: HazardSource

    private let detourOffsetMeters: Double = 60
    private let maxHazardsToDetourAround = 2
    /// Only hazards at least this severe justify a waypoint detour onto the street network.
    private let minDetourSeverity: Severity = .medium
    /// Don't propose a "safer" route that takes more than twice as long.
    private let maxSlowdownFactor = 2.0
    /// Server limit is 5000 points per request; stay well under it.
    private let requestPointBudget = 4000
    /// Extra query width, so thinning a long polyline for the request can't drop a hazard that is
    /// inside the corridor of the exact path. Hazards are then filtered against the exact path.
    private let queryMarginMeters: Double = 20

    init(directions: @escaping Directions, hazardSource: @escaping HazardSource) {
        self.directions = directions
        self.hazardSource = hazardSource
    }

    func plan(from source: CLLocationCoordinate2D, to destination: CLLocationCoordinate2D,
              destinationName: String, destinationItem: MKMapItem? = nil,
              corridorMeters: Double = RoutingSettings.corridorMeters) async throws -> RoutePlan {
        let target: RouteEndpoint = destinationItem.map { .place($0) } ?? .coordinate(destination)
        let legs = try await directions(source, target, true)
        guard !legs.isEmpty else { throw RouteAvoidanceError.noRouteFound }

        func makePlan(original: RouteOption, safer: RouteOption?, assessment: HazardAssessment, hazards: [Hazard]) -> RoutePlan {
            RoutePlan(destinationName: destinationName, destination: destination, destinationItem: destinationItem,
                      original: original, safer: safer, assessment: assessment, assessedHazards: hazards)
        }

        let response: RouteHazardsResponse
        do {
            response = try await assess(legs.map(\.coordinates), corridorMeters: corridorMeters)
        } catch {
            // Directions still work; say plainly that hazards were not checked.
            return makePlan(original: RouteOption(legs: [legs[0]], hazards: []), safer: nil,
                            assessment: .unavailable("Reported hazards couldn't be checked for this route. Take care."),
                            hazards: [])
        }
        let assessment = Self.assessment(of: response)
        var known = response.hazards
        let options = legs.map { option(legs: [$0], hazards: known, corridorMeters: corridorMeters) }
        let original = options[0]
        guard original.riskScore > 0, assessment.isComplete else {
            return makePlan(original: original, safer: nil, assessment: assessment, hazards: known)
        }

        // MapKit's alternates follow real walkways; prefer them whenever one lowers the risk.
        if let alternate = safest(Array(options.dropFirst()), than: original) {
            return makePlan(original: original, safer: alternate, assessment: assessment, hazards: known)
        }

        let base = options.min { ($0.riskScore, $0.expectedTravelTime) < ($1.riskScore, $1.expectedTravelTime) } ?? original
        let worst = base.hazards
            .filter { $0.hazard.severity >= minDetourSeverity }
            .sorted { ($0.hazard.severity, -$0.distanceFromPath) > ($1.hazard.severity, -$1.distanceFromPath) }
            .prefix(maxHazardsToDetourAround)
        var detourLegs: [[WalkingLeg]] = []
        for routeHazard in worst {
            for side in [1.0, -1.0] {
                let waypoint = detourWaypoint(around: routeHazard.hazard.coordinate, on: base, side: side)
                if let legs = try? await detour(from: source, via: waypoint, to: target) {
                    detourLegs.append(legs)
                }
            }
        }
        guard !detourLegs.isEmpty else { return makePlan(original: original, safer: nil, assessment: assessment, hazards: known) }

        // Detours can leave the area assessed above: assess their own geometry before scoring them.
        guard let detourResponse = try? await assess(detourLegs.map { $0.flatMap(\.coordinates) }, corridorMeters: corridorMeters),
              detourResponse.complete else {
            return makePlan(original: original, safer: nil, assessment: assessment, hazards: known)
        }
        let knownIds = Set(known.map(\.id))
        known += detourResponse.hazards.filter { !knownIds.contains($0.id) }
        let detours = detourLegs.map { option(legs: $0, hazards: known, corridorMeters: corridorMeters) }
        return makePlan(original: original, safer: safest(detours, than: original), assessment: assessment, hazards: known)
    }

    static func assessment(of response: RouteHazardsResponse) -> HazardAssessment {
        if response.complete { return .complete }
        if response.leavesCoverageArea {
            return .incomplete("Part of this route is outside the area SafeRoute covers, so hazards there aren't tracked.")
        }
        return .incomplete("There are more reported hazards along this route than could be checked. Take care.")
    }

    private func assess(_ routes: [[CLLocationCoordinate2D]], corridorMeters: Double) async throws -> RouteHazardsResponse {
        let perRoute = max(2, requestPointBudget / max(1, routes.count))
        return try await hazardSource(routes.map { Self.downsample($0, maxPoints: perRoute) }, corridorMeters + queryMarginMeters)
    }

    private func safest(_ candidates: [RouteOption], than original: RouteOption) -> RouteOption? {
        candidates
            .filter { $0.riskScore < original.riskScore && $0.expectedTravelTime <= original.expectedTravelTime * maxSlowdownFactor }
            .min { ($0.riskScore, $0.expectedTravelTime) < ($1.riskScore, $1.expectedTravelTime) }
    }

    private func detour(from source: CLLocationCoordinate2D, via waypoint: CLLocationCoordinate2D,
                        to destination: RouteEndpoint) async throws -> [WalkingLeg] {
        guard let leg1 = try await directions(source, .coordinate(waypoint), false).first,
              let leg2 = try await directions(waypoint, destination, false).first else {
            throw RouteAvoidanceError.noRouteFound
        }
        return [leg1, leg2]
    }

    /// Hazards within the corridor of the exact leg geometry.
    private func option(legs: [WalkingLeg], hazards: [Hazard], corridorMeters: Double) -> RouteOption {
        let onRoute = hazards.compactMap { hazard -> RouteHazard? in
            guard hazard.status.isActive else { return nil }
            let d = legs.map { Self.distance(from: hazard.coordinate, to: $0.polyline) }.min() ?? .greatestFiniteMagnitude
            return d <= corridorMeters ? RouteHazard(hazard: hazard, distanceFromPath: d) : nil
        }
        return RouteOption(legs: legs, hazards: onRoute.sorted { $0.hazard.severity > $1.hazard.severity })
    }

    /// Offsets a point perpendicular to the route's *local* direction at the hazard.
    private func detourWaypoint(around hazard: CLLocationCoordinate2D, on option: RouteOption, side: Double) -> CLLocationCoordinate2D {
        let coords = option.coordinates
        let target = MKMapPoint(hazard)
        var bestIndex = 0
        var bestDistance = Double.greatestFiniteMagnitude
        for i in 0..<max(0, coords.count - 1) {
            let d = target.distance(toSegmentFrom: MKMapPoint(coords[i]), to: MKMapPoint(coords[i + 1]))
            if d < bestDistance { bestDistance = d; bestIndex = i }
        }
        let bearing = coords.count > 1 ? coords[bestIndex].bearing(to: coords[bestIndex + 1]) : 0
        return hazard.offset(distanceMeters: detourOffsetMeters, bearingRadians: bearing + side * .pi / 2)
    }

    nonisolated static func downsample(_ points: [CLLocationCoordinate2D], maxPoints: Int) -> [CLLocationCoordinate2D] {
        guard points.count > maxPoints, maxPoints >= 2 else { return points }
        let stride = Double(points.count - 1) / Double(maxPoints - 1)
        return (0..<maxPoints).map { points[Int((Double($0) * stride).rounded())] }
    }

    nonisolated static func distance(from coordinate: CLLocationCoordinate2D, to polyline: MKPolyline) -> Double {
        let point = MKMapPoint(coordinate)
        let points = polyline.points()
        guard polyline.pointCount > 1 else { return .greatestFiniteMagnitude }
        var minDistance = Double.greatestFiniteMagnitude
        for i in 0..<(polyline.pointCount - 1) {
            minDistance = min(minDistance, point.distance(toSegmentFrom: points[i], to: points[i + 1]))
        }
        return minDistance
    }
}

/// Walking directions from Apple Maps.
@MainActor
enum MapKitDirections {
    static func walkingRoutes(from source: CLLocationCoordinate2D, to destination: RouteEndpoint,
                              alternates: Bool) async throws -> [WalkingLeg] {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: source))
        switch destination {
        case .coordinate(let coordinate): request.destination = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        case .place(let item): request.destination = item
        }
        request.transportType = .walking
        request.requestsAlternateRoutes = alternates
        return try await MKDirections(request: request).calculate().routes.map(WalkingLeg.init(route:))
    }
}

private extension MKMapPoint {
    /// Distance in meters from this point to the closest point on segment [a, b].
    func distance(toSegmentFrom a: MKMapPoint, to b: MKMapPoint) -> Double {
        let dx = b.x - a.x
        let dy = b.y - a.y
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared > 0 else { return distance(to: a) }
        var t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared
        t = max(0, min(1, t))
        return distance(to: MKMapPoint(x: a.x + t * dx, y: a.y + t * dy))
    }
}

private extension CLLocationCoordinate2D {
    func bearing(to other: CLLocationCoordinate2D) -> Double {
        let lat1 = latitude * .pi / 180, lat2 = other.latitude * .pi / 180
        let dLon = (other.longitude - longitude) * .pi / 180
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        return atan2(y, x)
    }

    func offset(distanceMeters: Double, bearingRadians: Double) -> CLLocationCoordinate2D {
        let earthRadius = 6_371_000.0
        let lat1 = latitude * .pi / 180, lon1 = longitude * .pi / 180
        let angularDistance = distanceMeters / earthRadius
        let lat2 = asin(sin(lat1) * cos(angularDistance) + cos(lat1) * sin(angularDistance) * cos(bearingRadians))
        let lon2 = lon1 + atan2(sin(bearingRadians) * sin(angularDistance) * cos(lat1),
                                cos(angularDistance) - sin(lat1) * sin(lat2))
        return CLLocationCoordinate2D(latitude: lat2 * 180 / .pi, longitude: lon2 * 180 / .pi)
    }
}
