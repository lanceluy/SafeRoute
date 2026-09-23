import Foundation
import MapKit

struct RouteHazard: Identifiable, Hashable, Sendable {
    let hazard: Hazard
    /// Shortest distance from the hazard to the route polyline, in meters.
    let distanceFromPath: Double
    var id: UUID { hazard.id }
}

/// One candidate route. A waypoint detour has two legs; **all** legs are rendered.
/// @unchecked: MKRoute isn't annotated Sendable, but these values are never mutated after creation.
struct RouteOption: @unchecked Sendable {
    let legs: [MKRoute]
    let hazards: [RouteHazard]

    var expectedTravelTime: TimeInterval { legs.reduce(0) { $0 + $1.expectedTravelTime } }
    var distance: CLLocationDistance { legs.reduce(0) { $0 + $1.distance } }
    var polylines: [MKPolyline] { legs.map(\.polyline) }

    var coordinates: [CLLocationCoordinate2D] {
        legs.flatMap { leg -> [CLLocationCoordinate2D] in
            let polyline = leg.polyline
            var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: polyline.pointCount)
            polyline.getCoordinates(&coords, range: NSRange(location: 0, length: polyline.pointCount))
            return coords
        }
    }

    /// Weighted hazard exposure: high-severity hazards dominate; disputed ones count half.
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

struct RoutePlan: Identifiable, Sendable {
    let id = UUID()
    let destinationName: String
    let destination: CLLocationCoordinate2D
    /// MapKit's recommended (fastest) walking route.
    let original: RouteOption
    /// A lower-risk alternative, or nil when the original is already clear or nothing better exists.
    let safer: RouteOption?

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

/// MapKit has no native "avoid this point" API, so this scores MKDirections' alternates against
/// active hazards near each path and, if all of them still pass a hazard, synthesizes waypoint
/// detours on both sides of the worst hazard. Bounded so it can't loop forever or trip MapKit's
/// request throttling.
struct RouteAvoidanceService: Sendable {
    static let shared = RouteAvoidanceService()

    /// A hazard this close to the path is considered "on" the route.
    private let corridorMeters: Double = 25
    private let detourOffsetMeters: Double = 60
    private let maxHazardsToDetourAround = 2
    /// Don't propose a "safer" route that takes more than twice as long.
    private let maxSlowdownFactor = 2.0

    func plan(from source: CLLocationCoordinate2D, to destination: CLLocationCoordinate2D, destinationName: String) async throws -> RoutePlan {
        let routes = try await requestRoutes(from: source, to: destination)
        guard !routes.isEmpty else { throw RouteAvoidanceError.noRouteFound }
        let hazards = (try? await fetchHazards(around: routes.map(\.polyline) )) ?? []

        let options = routes.map { option(legs: [$0], hazards: hazards) }
        let original = options[0]
        guard original.riskScore > 0 else {
            return RoutePlan(destinationName: destinationName, destination: destination, original: original, safer: nil)
        }

        var candidates = Array(options.dropFirst())
        let base = options.min { ($0.riskScore, $0.expectedTravelTime) < ($1.riskScore, $1.expectedTravelTime) } ?? original
        if base.riskScore > 0 {
            let worst = base.hazards
                .sorted { ($0.hazard.severity, -$0.distanceFromPath) > ($1.hazard.severity, -$1.distanceFromPath) }
                .prefix(maxHazardsToDetourAround)
            for routeHazard in worst {
                for side in [1.0, -1.0] {
                    let waypoint = detourWaypoint(around: routeHazard.hazard.coordinate, on: base, side: side)
                    if let detour = try? await detourOption(from: source, via: waypoint, to: destination, hazards: hazards) {
                        candidates.append(detour)
                    }
                }
            }
        }

        let acceptable = candidates.filter {
            $0.riskScore < original.riskScore && $0.expectedTravelTime <= original.expectedTravelTime * maxSlowdownFactor
        }
        let safer = acceptable.min { ($0.riskScore, $0.expectedTravelTime) < ($1.riskScore, $1.expectedTravelTime) }
        return RoutePlan(destinationName: destinationName, destination: destination, original: original, safer: safer)
    }

    private func detourOption(from source: CLLocationCoordinate2D, via waypoint: CLLocationCoordinate2D,
                              to destination: CLLocationCoordinate2D, hazards: [Hazard]) async throws -> RouteOption {
        guard let leg1 = try await requestRoutes(from: source, to: waypoint, alternates: false).first,
              let leg2 = try await requestRoutes(from: waypoint, to: destination, alternates: false).first else {
            throw RouteAvoidanceError.noRouteFound
        }
        return option(legs: [leg1, leg2], hazards: hazards)
    }

    private func option(legs: [MKRoute], hazards: [Hazard]) -> RouteOption {
        let onRoute = hazards.compactMap { hazard -> RouteHazard? in
            guard hazard.status.isActive else { return nil }
            let d = legs.map { Self.distance(from: hazard.coordinate, to: $0.polyline) }.min() ?? .greatestFiniteMagnitude
            return d <= corridorMeters ? RouteHazard(hazard: hazard, distanceFromPath: d) : nil
        }
        return RouteOption(legs: legs, hazards: onRoute.sorted { $0.hazard.severity > $1.hazard.severity })
    }

    private func requestRoutes(from source: CLLocationCoordinate2D, to destination: CLLocationCoordinate2D,
                               alternates: Bool = true) async throws -> [MKRoute] {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: source))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: destination))
        request.transportType = .walking
        request.requestsAlternateRoutes = alternates
        return try await MKDirections(request: request).calculate().routes
    }

    private func fetchHazards(around polylines: [MKPolyline]) async throws -> [Hazard] {
        var rect = polylines.reduce(MKMapRect.null) { $0.union($1.boundingMapRect) }
        rect = rect.insetBy(dx: -rect.size.width * 0.1 - 500, dy: -rect.size.height * 0.1 - 500)
        let region = MKCoordinateRegion(rect)
        let latSpan = min(region.span.latitudeDelta, MapViewModel.maxSpanDegrees)
        let lonSpan = min(region.span.longitudeDelta, MapViewModel.maxSpanDegrees)
        return try await APIClient.shared.send(.inBbox(
            minLat: region.center.latitude - latSpan / 2, minLon: region.center.longitude - lonSpan / 2,
            maxLat: region.center.latitude + latSpan / 2, maxLon: region.center.longitude + lonSpan / 2), as: [Hazard].self)
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

    static func distance(from coordinate: CLLocationCoordinate2D, to polyline: MKPolyline) -> Double {
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
