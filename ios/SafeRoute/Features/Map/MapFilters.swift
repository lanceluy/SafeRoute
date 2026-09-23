import Foundation

struct MapFilters: Equatable, Codable {
    enum DistanceLimit: Int, CaseIterable, Codable, Identifiable {
        case any = 0
        case m500 = 500
        case km1 = 1000
        case km5 = 5000

        var id: Int { rawValue }
        var label: String {
            switch self {
            case .any: return "Anywhere on the map"
            case .m500: return "500 m"
            case .km1: return "1 km"
            case .km5: return "5 km"
            }
        }
    }

    var types: Set<HazardType> = Set(HazardType.reportable)
    var statuses: Set<HazardStatus> = HazardStatus.active
    var distance: DistanceLimit = .any

    static let `default` = MapFilters()

    var isDefault: Bool { self == .default }

    /// Statuses the user can toggle in the filter sheet.
    static let selectableStatuses: [HazardStatus] = [.verified, .reported, .disputed, .resolved]

    private static let key = "saferoute.mapFilters"

    static func load() -> MapFilters {
        guard let data = UserDefaults.standard.data(forKey: key),
              let filters = try? JSONDecoder().decode(MapFilters.self, from: data) else { return .default }
        return filters
    }

    func save() {
        UserDefaults.standard.set(try? JSONEncoder().encode(self), forKey: Self.key)
    }
}
