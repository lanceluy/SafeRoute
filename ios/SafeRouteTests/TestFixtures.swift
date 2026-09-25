import CoreLocation
import MapKit
@testable import SafeRoute

/// Geometry and model builders shared by the tests. Routes are laid out in meters around a
/// fixed origin in Makati so distances are easy to reason about.
enum Fixtures {
    static let origin = CLLocationCoordinate2D(latitude: 14.5547, longitude: 121.0244)

    static func point(north: Double, east: Double) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: origin.latitude + north / 111_320.0,
                               longitude: origin.longitude + east / (111_320.0 * cos(origin.latitude * .pi / 180)))
    }

    static func leg(_ points: [CLLocationCoordinate2D], secondsPerMeter: Double = 0.8,
                    steps: [WalkingStep] = []) -> WalkingLeg {
        var coords = points
        let polyline = MKPolyline(coordinates: &coords, count: coords.count)
        var length = 0.0
        for i in 1..<points.count {
            length += CLLocation(latitude: points[i - 1].latitude, longitude: points[i - 1].longitude)
                .distance(from: CLLocation(latitude: points[i].latitude, longitude: points[i].longitude))
        }
        return WalkingLeg(polyline: polyline, distance: length, expectedTravelTime: length * secondsPerMeter, steps: steps)
    }

    static func hazard(at coordinate: CLLocationCoordinate2D, type: HazardType = .openManhole,
                       severity: Severity = .high, status: HazardStatus = .reported,
                       version: Int64? = 0, id: UUID = UUID()) -> Hazard {
        Hazard(id: id, type: type, latitude: coordinate.latitude, longitude: coordinate.longitude,
               description: nil, photoUrl: nil, status: status, severity: severity, severityAnswer: nil,
               confirmationCount: 0, disputeCount: 0, confidence: nil, reporterId: nil,
               createdAt: Date(), updatedAt: Date(), lastConfirmedAt: nil, expiresAt: nil, resolvedAt: nil,
               version: version)
    }

    static func response(_ hazards: [Hazard], complete: Bool = true, truncated: Bool = false,
                         leavesCoverageArea: Bool = false) -> RouteHazardsResponse {
        RouteHazardsResponse(hazards: hazards, complete: complete, truncated: truncated,
                             leavesCoverageArea: leavesCoverageArea, corridorMeters: 60)
    }

    static func plan(route: [CLLocationCoordinate2D], assessedHazards: [Hazard] = [],
                     assessment: HazardAssessment = .complete) -> (RoutePlan, RouteOption) {
        let option = RouteOption(legs: [leg(route)], hazards: [])
        let plan = RoutePlan(destinationName: "Test", destination: route.last!, destinationItem: nil,
                             original: option, safer: nil, assessment: assessment, assessedHazards: assessedHazards)
        return (plan, option)
    }
}

struct TestFailure: Error {}
