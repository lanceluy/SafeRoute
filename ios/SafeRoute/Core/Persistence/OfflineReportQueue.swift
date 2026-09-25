import Foundation

/// Reports submitted while offline are kept on disk (with their photo) and sent automatically
/// when connectivity returns.
///
/// Each account has its own queue directory, and only the signed-in owner's queue is loaded or
/// sent. Every request is also bound to its owner (`APIEndpoint.acting(as:)`), so even a sign-out
/// in the middle of an upload can't send one person's report with another person's credentials.
@MainActor
final class OfflineReportQueue: ObservableObject {
    struct QueuedReport: Codable, Identifiable {
        let id: UUID
        let ownerId: UUID
        var request: HazardSubmissionRequest
        var imageFileName: String?
        let queuedAt: Date
        var lastError: String?
    }

    enum QueueError: LocalizedError {
        case notSignedIn
        case storage(Error)

        var errorDescription: String? {
            switch self {
            case .notSignedIn: return "Sign in to save reports for later."
            case .storage: return "Your report couldn't be saved on this device. Check free storage and try again."
            }
        }
    }

    @Published private(set) var items: [QueuedReport] = []
    private(set) var ownerId: UUID?
    private var isFlushing = false
    private let root: URL

    init(root: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OfflineReports", isDirectory: true)) {
        self.root = root
    }

    /// Loads the signed-in account's queue.
    func activate(ownerId: UUID) {
        self.ownerId = ownerId
        items = (try? Data(contentsOf: indexURL(for: ownerId)))
            .flatMap { try? JSONDecoder.api.decode([QueuedReport].self, from: $0) }?
            .filter { $0.ownerId == ownerId } ?? []
    }

    /// Signed out: the queue stays on disk for its owner but nothing is visible or sendable.
    func deactivate() {
        ownerId = nil
        items = []
    }

    /// Saves a report for later. Throws if it could not be written to disk, so the caller never
    /// tells the user a report is safe when it isn't.
    func enqueue(_ request: HazardSubmissionRequest, imageData: Data?) throws {
        guard let ownerId else { throw QueueError.notSignedIn }
        let directory = directory(for: ownerId)
        var fileName: String?
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if let imageData {
                let name = UUID().uuidString + ".jpg"
                try imageData.write(to: directory.appendingPathComponent(name), options: .atomic)
                fileName = name
            }
            var request = request
            request.clientRequestId = request.clientRequestId ?? UUID()
            request.observedAt = request.observedAt ?? Date()
            let updated = items + [QueuedReport(id: UUID(), ownerId: ownerId, request: request,
                                                imageFileName: fileName, queuedAt: Date())]
            try persist(updated, for: ownerId)
            items = updated
        } catch {
            if let fileName { try? FileManager.default.removeItem(at: directory.appendingPathComponent(fileName)) }
            throw QueueError.storage(error)
        }
    }

    func remove(_ id: UUID) {
        guard let ownerId else { return }
        if let item = items.first(where: { $0.id == id }), let name = item.imageFileName {
            try? FileManager.default.removeItem(at: directory(for: ownerId).appendingPathComponent(name))
        }
        items.removeAll { $0.id == id }
        try? persist(items, for: ownerId)
    }

    /// Sends the owner's queued reports oldest-first. Stops (keeping the rest) when offline, rate
    /// limited, the server is failing, or the account changes. A report too old to publish is
    /// dropped and reported through `onDropped`.
    func flush(onSubmitted: (HazardSubmission, HazardSubmissionRequest) -> Void,
               onDropped: (QueuedReport, String) -> Void) async {
        guard let owner = ownerId, !isFlushing, !items.isEmpty else { return }
        isFlushing = true
        defer { isFlushing = false }
        for item in items where item.ownerId == owner {
            guard ownerId == owner else { return } // signed out while flushing
            do {
                var request = item.request
                if request.photoUrl == nil, let name = item.imageFileName,
                   let data = try? Data(contentsOf: directory(for: owner).appendingPathComponent(name)) {
                    let stored = try await APIClient.shared.send(
                        APIEndpoint.uploadHazardImage(jpeg: data).acting(as: owner), as: StoredImage.self)
                    guard ownerId == owner else { return }
                    request.photoUrl = stored.url
                    update(item.id) { $0.request.photoUrl = stored.url }
                }
                let submission = try await APIClient.shared.send(
                    APIEndpoint.submitHazard(request).acting(as: owner), as: HazardSubmission.self)
                guard ownerId == owner else { return }
                remove(item.id)
                onSubmitted(submission, request)
            } catch APIError.sessionChanged {
                return
            } catch APIError.rateLimited {
                return // try again on the next flush
            } catch let error as APIError where error.isConnectivityProblem {
                return
            } catch APIError.server(_, let code, let message) where code == "REPORT_TOO_OLD" {
                remove(item.id)
                onDropped(item, message)
            } catch {
                update(item.id) { $0.lastError = error.localizedDescription }
            }
        }
    }

    private func update(_ id: UUID, _ change: (inout QueuedReport) -> Void) {
        guard let ownerId, let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
        try? persist(items, for: ownerId)
    }

    private func directory(for owner: UUID) -> URL {
        root.appendingPathComponent(owner.uuidString, isDirectory: true)
    }

    private func indexURL(for owner: UUID) -> URL {
        directory(for: owner).appendingPathComponent("queue.json")
    }

    private func persist(_ items: [QueuedReport], for owner: UUID) throws {
        try FileManager.default.createDirectory(at: directory(for: owner), withIntermediateDirectories: true)
        try JSONEncoder.api.encode(items).write(to: indexURL(for: owner), options: .atomic)
    }
}
