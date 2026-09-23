import Foundation
import CoreLocation

/// What the Active tab shows and how it's narrowed down. Persisted per device.
struct ActiveHazardsFilter: Codable, Equatable {
    enum Scope: String, Codable, CaseIterable, Identifiable {
        case mine, nearby
        var id: String { rawValue }
        var label: String { self == .mine ? "My reports" : "All nearby" }
    }

    enum Range: Int, Codable, CaseIterable, Identifiable {
        case any = 0, m500 = 500, km1 = 1000, km2 = 2000, km5 = 5000
        var id: Int { rawValue }
        var label: String {
            switch self {
            case .any: return "Any distance"
            case .m500: return "500 m"
            case .km1: return "1 km"
            case .km2: return "2 km"
            case .km5: return "5 km"
            }
        }
        var meters: Double? { self == .any ? nil : Double(rawValue) }
    }

    enum Sort: String, Codable, CaseIterable, Identifiable {
        case newest, nearest, mostConfirmed
        var id: String { rawValue }
        var label: String {
            switch self {
            case .newest: return "Newest"
            case .nearest: return "Nearest"
            case .mostConfirmed: return "Most confirmed"
            }
        }
    }

    var scope: Scope = .mine
    var range: Range = .any
    var types: Set<HazardType> = Set(HazardType.reportable)
    var severities: Set<Severity> = [.high, .medium, .low]
    var sort: Sort = .newest

    static let `default` = ActiveHazardsFilter()

    /// "All nearby" always needs a range; the server caps nearby queries at 5 km.
    var effectiveRange: Range {
        scope == .nearby && range == .any ? .km1 : range
    }

    /// Filters other than the scope that differ from the defaults.
    var activeRefinementCount: Int {
        var n = 0
        if range != .any { n += 1 }
        if types != ActiveHazardsFilter.default.types { n += 1 }
        if severities != ActiveHazardsFilter.default.severities { n += 1 }
        if sort != .newest { n += 1 }
        return n
    }

    var summary: String {
        var parts: [String] = []
        parts.append(effectiveRange == .any ? "Any distance" : "Within \(effectiveRange.label)")
        if types.count < HazardType.reportable.count { parts.append("\(types.count) type\(types.count == 1 ? "" : "s")") }
        if severities.count < 3 {
            parts.append(Severity.allLevels.filter { severities.contains($0) }.map(\.shortLabel).joined(separator: " + "))
        }
        parts.append(sort.label)
        return parts.joined(separator: " · ")
    }

    /// Applies type/severity/range and sorts. `location` may be nil (range/nearest then ignored).
    func apply(to hazards: [(hazard: Hazard, createdAt: Date)], from location: CLLocationCoordinate2D?) -> [(hazard: Hazard, distance: Double?)] {
        let matching = hazards.compactMap { item -> (hazard: Hazard, createdAt: Date, distance: Double?)? in
            guard types.contains(item.hazard.type), severities.contains(item.hazard.severity) else { return nil }
            let distance = Format.distance(from: location, to: item.hazard.coordinate)
            if let limit = effectiveRange.meters, let distance, distance > limit { return nil }
            return (item.hazard, item.createdAt, distance)
        }
        let sorted: [(hazard: Hazard, createdAt: Date, distance: Double?)]
        switch sort {
        case .newest: sorted = matching.sorted { $0.createdAt > $1.createdAt }
        case .nearest: sorted = matching.sorted { ($0.distance ?? .infinity) < ($1.distance ?? .infinity) }
        case .mostConfirmed: sorted = matching.sorted { ($0.hazard.confirmationCount, $0.createdAt) > ($1.hazard.confirmationCount, $1.createdAt) }
        }
        return sorted.map { ($0.hazard, $0.distance) }
    }

    private static let key = "saferoute.activeHazardsFilter"

    static func load() -> ActiveHazardsFilter {
        guard let data = UserDefaults.standard.data(forKey: key),
              let filter = try? JSONDecoder().decode(ActiveHazardsFilter.self, from: data) else { return .default }
        return filter
    }

    func save() {
        UserDefaults.standard.set(try? JSONEncoder().encode(self), forKey: Self.key)
    }
}

extension Severity {
    static let allLevels: [Severity] = [.high, .medium, .low]
}

/// Active hazards from every commuter around the user, for the "All nearby" scope.
@MainActor
final class NearbyHazardsModel: ObservableObject {
    @Published private(set) var hazards: [Hazard] = []
    @Published private(set) var loadState: LoadState = .idle
    private var lastQuery: String?

    func load(around location: CLLocationCoordinate2D, filter: ActiveHazardsFilter, force: Bool = false) async {
        let radius = filter.effectiveRange.meters ?? 5000
        let types = filter.types.count == HazardType.reportable.count ? nil : Array(filter.types)
        let query = String(format: "%.4f,%.4f,%.0f,%@", location.latitude, location.longitude, radius,
                           (types ?? []).map(\.rawValue).sorted().joined(separator: ","))
        guard force || query != lastQuery || loadState != .loaded else { return }
        lastQuery = query
        if hazards.isEmpty { loadState = .loading }
        do {
            hazards = try await APIClient.shared.send(
                .nearby(lat: location.latitude, lon: location.longitude, radiusMeters: radius, types: types),
                as: [Hazard].self)
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }
}
