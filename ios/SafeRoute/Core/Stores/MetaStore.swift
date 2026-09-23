import Foundation

/// Server-provided configuration (coverage area, severity questions), cached so the report flow
/// still works offline.
@MainActor
final class MetaStore: ObservableObject {
    @Published private(set) var coverage: CoverageArea?
    @Published private(set) var questions: [HazardType: SeverityQuestion] = [:]

    private let coverageKey = "saferoute.meta.coverage"
    private let questionsKey = "saferoute.meta.questions"

    init() {
        if let data = UserDefaults.standard.data(forKey: coverageKey) {
            coverage = try? JSONDecoder.api.decode(CoverageArea.self, from: data)
        }
        if let data = UserDefaults.standard.data(forKey: questionsKey),
           let list = try? JSONDecoder.api.decode([SeverityQuestion].self, from: data) {
            questions = Dictionary(uniqueKeysWithValues: list.map { ($0.type, $0) })
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
    }
}
