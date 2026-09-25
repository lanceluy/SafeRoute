import Foundation

/// POST /api/hazards/along-route: every active hazard within the corridor of the candidate routes.
struct RouteHazardsResponse: Codable {
    let hazards: [Hazard]
    /// False if the result was capped or a route leaves the pilot area. An incomplete result must
    /// never be presented as "no hazards".
    let complete: Bool
    let truncated: Bool
    let leavesCoverageArea: Bool
    let corridorMeters: Double
}

struct RouteHazardsRequest: Codable {
    /// Each route is a list of [latitude, longitude] pairs.
    let routes: [[[Double]]]
    /// Nil uses the server's route corridor.
    let corridorMeters: Double?
}

/// GET /api/meta/routing: what "on the route" means, shared by the server's on-route alerts,
/// route assessment and in-app navigation.
struct RoutingMeta: Codable {
    let routeCorridorMeters: Double
}
