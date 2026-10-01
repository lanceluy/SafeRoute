import Foundation

/// The last hazards the map knew about, kept on disk so they're still shown when the app opens
/// without internet. Live updates and the next load replace them once the connection is back
/// (`MapViewModel.refresh` on reconnect reconciles anything resolved meanwhile).
///
/// Bound to the account that saved it, like the offline report queue, and cleared on sign-out.
struct HazardCache {
    struct Snapshot: Codable {
        let ownerId: UUID
        let savedAt: Date
        let hazards: [Hazard]
    }

    /// Enough for a few districts; the nearest-to-last-view ones are kept beyond that.
    static let maxHazards = 1500

    let file: URL

    init(file: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("HazardCache.json")) {
        self.file = file
    }

    /// Active hazards only: closed ones aren't drawn anyway, and they're the bulk of old data.
    func save(_ hazards: [Hazard], ownerId: UUID, now: Date = Date()) throws {
        let kept = hazards.filter { $0.status.isActive && ($0.expiresAt ?? .distantFuture) > now }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(Self.maxHazards)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder.api.encode(Snapshot(ownerId: ownerId, savedAt: now, hazards: Array(kept)))
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// The saved hazards for this account that haven't expired since; nil if there's nothing usable.
    func load(ownerId: UUID, now: Date = Date()) -> Snapshot? {
        guard let data = try? Data(contentsOf: file),
              let snapshot = try? JSONDecoder.api.decode(Snapshot.self, from: data),
              snapshot.ownerId == ownerId else { return nil }
        let live = snapshot.hazards.filter { ($0.expiresAt ?? .distantFuture) > now }
        return Snapshot(ownerId: ownerId, savedAt: snapshot.savedAt, hazards: live)
    }

    func clear() {
        try? FileManager.default.removeItem(at: file)
    }
}
