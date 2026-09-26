import Foundation

/// Filtering, sorting and wording for the Nearby Hazards sheet, kept apart from the view so it
/// can be tested.
enum NearbyHazardList {
    struct Item: Identifiable {
        let hazard: Hazard
        /// nil when the user's location is unknown (the list then covers the visible map).
        let distance: Double?
        var id: UUID { hazard.id }
    }

    enum SeverityFilter: Hashable, CaseIterable {
        case all, high, medium, low

        var severity: Severity? {
            switch self {
            case .all: return nil
            case .high: return .high
            case .medium: return .medium
            case .low: return .low
            }
        }

        var title: String {
            switch self {
            case .all: return "All"
            case .high: return "High"
            case .medium: return "Medium"
            case .low: return "Low"
            }
        }
    }

    enum Sort: String, CaseIterable, Identifiable {
        case nearest = "Nearest"
        case newest = "Newest"
        case severity = "Most severe"
        var id: String { rawValue }
    }

    /// A report nobody has confirmed for this long may no longer be there.
    static let staleAfter: TimeInterval = 3 * 24 * 3600
    /// Average walking pace used for "~6 min walk".
    static let walkingSpeed: Double = 1.4

    static func counts(_ items: [Item]) -> [Severity: Int] {
        var counts: [Severity: Int] = [.high: 0, .medium: 0, .low: 0]
        for item in items where counts[item.hazard.severity] != nil { counts[item.hazard.severity]! += 1 }
        return counts
    }

    /// Hazard types present in the list, in a stable order, so the type chips never offer an
    /// empty filter.
    static func typesPresent(_ items: [Item]) -> [HazardType] {
        let present = Set(items.map(\.hazard.type))
        return HazardType.allCases.filter { present.contains($0) }
    }

    static func apply(_ items: [Item], severity: SeverityFilter, type: HazardType?, sort: Sort) -> [Item] {
        let filtered = items.filter { item in
            (severity.severity.map { item.hazard.severity == $0 } ?? true)
                && (type.map { item.hazard.type == $0 } ?? true)
        }
        return filtered.sorted { a, b in
            switch sort {
            case .nearest:
                switch (a.distance, b.distance) {
                case let (x?, y?) where x != y: return x < y
                case (nil, _?): return false
                case (_?, nil): return true
                default: return a.hazard.createdAt > b.hazard.createdAt
                }
            case .newest:
                return a.hazard.createdAt > b.hazard.createdAt
            case .severity:
                if a.hazard.severity != b.hazard.severity { return a.hazard.severity > b.hazard.severity }
                return (a.distance ?? .infinity) < (b.distance ?? .infinity)
            }
        }
    }

    /// "7 reports within 1 km" / "1 report in the visible map area".
    static func subtitle(count: Int, hasLocation: Bool, radiusMeters: Double) -> String {
        let noun = count == 1 ? "report" : "reports"
        guard hasLocation else { return "\(count) \(noun) in the visible map area" }
        return "\(count) \(noun) within \(radius(radiusMeters))"
    }

    /// "1 km" rather than Format.distance's "1.0 km" for whole kilometres.
    static func radius(_ meters: Double) -> String {
        meters >= 1000 && meters.truncatingRemainder(dividingBy: 1000) == 0
            ? "\(Int(meters / 1000)) km" : Format.distance(meters)
    }

    /// Crowd trust in one phrase: "New report", "3 confirmations", "Verified · 4 confirmations".
    static func trust(_ hazard: Hazard) -> String {
        let count = hazard.confirmationCount
        let confirmations = count == 0 ? nil : "\(count) confirmation\(count == 1 ? "" : "s")"
        switch hazard.status {
        case .verified: return ["Verified", confirmations].compactMap { $0 }.joined(separator: " · ")
        case .disputed: return ["Disputed", confirmations].compactMap { $0 }.joined(separator: " · ")
        default: return confirmations ?? "New report"
        }
    }

    static func isPossiblyOutdated(_ hazard: Hazard, now: Date = Date()) -> Bool {
        now.timeIntervalSince(hazard.lastConfirmedAt ?? hazard.createdAt) > staleAfter
    }

    /// "~6 min walk"; nothing under a minute.
    static func walkingTime(_ meters: Double) -> String? {
        let minutes = Int((meters / walkingSpeed / 60).rounded())
        return minutes < 1 ? nil : "~\(minutes) min walk"
    }
}
