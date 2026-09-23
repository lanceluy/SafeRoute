import Foundation

/// Recent nearby / on-route alerts, persisted so the Alerts tab survives relaunches.
@MainActor
final class AlertsStore: ObservableObject {
    struct AlertItem: Codable, Identifiable, Hashable {
        let frame: HazardEventFrame
        let receivedAt: Date
        var read: Bool
        var id: String { frame.id }
    }

    @Published private(set) var items: [AlertItem] = []

    var unreadCount: Int { items.filter { !$0.read }.count }

    private let key = "saferoute.alerts.v2"
    private let maxItems = 100

    init() {
        if let data = UserDefaults.standard.data(forKey: key),
           let saved = try? JSONDecoder.api.decode([AlertItem].self, from: data) {
            items = saved
        }
    }

    func add(_ frame: HazardEventFrame) {
        guard !items.contains(where: { $0.id == frame.id }) else { return }
        items.insert(AlertItem(frame: frame, receivedAt: Date(), read: false), at: 0)
        if items.count > maxItems { items.removeLast(items.count - maxItems) }
        persist()
    }

    func markRead(_ id: String) {
        guard let index = items.firstIndex(where: { $0.id == id }), !items[index].read else { return }
        items[index].read = true
        persist()
    }

    func markAllRead() {
        for i in items.indices { items[i].read = true }
        persist()
    }

    func clear() {
        items = []
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder.api.encode(items) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}
