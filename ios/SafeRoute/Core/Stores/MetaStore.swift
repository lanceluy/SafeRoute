import Foundation

/// Server-provided configuration (coverage area, severity questions, routing corridor), cached so
/// the report flow and navigation still work offline.
@MainActor
final class MetaStore: ObservableObject {
    @Published private(set) var coverage: CoverageArea?
    @Published private(set) var questions: [HazardType: SeverityQuestion] = [:]

    private let coverageKey = "saferoute.meta.coverage"
    private let questionsKey = "saferoute.meta.questions"
    private let routingKey = "saferoute.meta.routing"

    init() {
        if let data = UserDefaults.standard.data(forKey: coverageKey) {
            coverage = try? JSONDecoder.api.decode(CoverageArea.self, from: data)
        }
        if let data = UserDefaults.standard.data(forKey: questionsKey),
           let list = try? JSONDecoder.api.decode([SeverityQuestion].self, from: data) {
            questions = Dictionary(uniqueKeysWithValues: list.map { ($0.type, $0) })
        }
        if let data = UserDefaults.standard.data(forKey: routingKey),
           let routing = try? JSONDecoder.api.decode(RoutingMeta.self, from: data) {
            RoutingSettings.corridorMeters = routing.routeCorridorMeters
        }
    }

    func refresh() async {
        if let coverage = try? await APIClient.shared.send(.coverage, as: CoverageArea.self) {
            self.coverage = coverage
            UserDefaults.standard.set(try? JSONEncoder.api.encode(coverage), forKey: coverageKey)
        }
        if let list = try? await APIClient.shared.send(.severityQuestions, as: [SeverityQuestion].self) {
            questions = Dictionary(list.map { ($0.type, $0) }, uniquingKeysWith: { a, _ in a })
            UserDefaults.standard.set(try? JSONEncoder.api.encode(list), forKey: questionsKey)
        }
        if let routing = try? await APIClient.shared.send(.routing, as: RoutingMeta.self) {
            RoutingSettings.corridorMeters = routing.routeCorridorMeters
            UserDefaults.standard.set(try? JSONEncoder.api.encode(routing), forKey: routingKey)
        }
    }
}
