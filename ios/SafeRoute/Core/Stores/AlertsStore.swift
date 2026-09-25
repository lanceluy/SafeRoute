import Foundation

/// Recent nearby / on-route alerts, persisted per account so the Alerts tab survives relaunches
/// without showing one person's location-linked history to the next person who signs in.
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

    private let defaults: UserDefaults
    private var userId: UUID?
    private let maxItems = 100

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        defaults.removeObject(forKey: "saferoute.alerts.v2") // pre-partitioning, not attributable to an account
    }

    private func key(for userId: UUID) -> String { "saferoute.alerts.v3.\(userId.uuidString)" }

    func activate(userId: UUID) {
        self.userId = userId
        items = defaults.data(forKey: key(for: userId))
            .flatMap { try? JSONDecoder.api.decode([AlertItem].self, from: $0) } ?? []
    }

    /// Signed out: the history stays with its owner and is no longer shown.
    func deactivate() {
        userId = nil
        items = []
    }

    func add(_ frame: HazardEventFrame) {
        guard userId != nil, !items.contains(where: { $0.id == frame.id }) else { return }
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
        guard let userId, let data = try? JSONEncoder.api.encode(items) else { return }
        defaults.set(data, forKey: key(for: userId))
    }
}
