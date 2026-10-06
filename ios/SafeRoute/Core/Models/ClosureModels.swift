import Foundation
import CoreLocation

/// A road or path a moderator has blocked (construction, flooding, an event). Shown on the map and
/// avoided by route planning while `isActive`. Coordinates are [latitude, longitude] pairs.
struct RoadClosure: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var reason: String
    /// CONSTRUCTION | FLOODING | EVENT | OTHER
    var category: String
    /// ACTIVE | LIFTED | EXPIRED
    var status: String
    /// How far either side of the line counts as blocked.
    var bufferMeters: Int
    var endsAt: Date?
    var version: Int64?
    var coordinates: [[Double]]

    var isActive: Bool { status == "ACTIVE" }

    var path: [CLLocationCoordinate2D] {
        coordinates.compactMap { $0.count == 2 ? CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) : nil }
    }

    /// Roughly the middle vertex: where the map's marker sits.
    var midpoint: CLLocationCoordinate2D? {
        let points = path
        return points.isEmpty ? nil : points[points.count / 2]
    }

    var categoryLabel: String {
        switch category {
        case "CONSTRUCTION": return "Construction"
        case "FLOODING": return "Flooding"
        case "EVENT": return "Event"
        default: return "Road closed"
        }
    }

    /// "Construction · until Oct 9, 5:00 PM" or "… · until lifted".
    var summary: String {
        let until = endsAt.map { "until \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "until lifted"
        return "\(categoryLabel) · \(until)"
    }
}
