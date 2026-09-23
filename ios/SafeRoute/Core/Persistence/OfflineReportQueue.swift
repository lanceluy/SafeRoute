import Foundation

/// Reports submitted while offline are kept on disk (with their photo) and sent automatically
/// when connectivity returns (review §24).
@MainActor
final class OfflineReportQueue: ObservableObject {
    struct QueuedReport: Codable, Identifiable {
        let id: UUID
        var request: HazardSubmissionRequest
        var imageFileName: String?
        let queuedAt: Date
        var lastError: String?
    }

    @Published private(set) var items: [QueuedReport] = []
    private var isFlushing = false

    private let directory: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OfflineReports", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()
    private var indexURL: URL { directory.appendingPathComponent("queue.json") }

    init() {
        if let data = try? Data(contentsOf: indexURL),
           let saved = try? JSONDecoder.api.decode([QueuedReport].self, from: data) {
            items = saved
        }
    }

    func enqueue(_ request: HazardSubmissionRequest, imageData: Data?) {
        var fileName: String?
        if let imageData {
            let name = UUID().uuidString + ".jpg"
            if (try? imageData.write(to: directory.appendingPathComponent(name))) != nil { fileName = name }
        }
        items.append(QueuedReport(id: UUID(), request: request, imageFileName: fileName, queuedAt: Date()))
        persist()
    }

    func remove(_ id: UUID) {
        if let item = items.first(where: { $0.id == id }), let name = item.imageFileName {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
        items.removeAll { $0.id == id }
        persist()
    }

    /// Sends queued reports oldest-first; stops at the first connectivity failure.
    func flush(onSubmitted: (HazardSubmission, HazardSubmissionRequest) -> Void) async {
        guard !isFlushing, !items.isEmpty else { return }
        isFlushing = true
        defer { isFlushing = false }
        for item in items {
            do {
                var request = item.request
                if request.photoUrl == nil, let name = item.imageFileName,
                   let data = try? Data(contentsOf: directory.appendingPathComponent(name)) {
                    let stored = try await APIClient.shared.send(.uploadHazardImage(jpeg: data), as: StoredImage.self)
                    request.photoUrl = stored.url
                    update(item.id) { $0.request.photoUrl = stored.url }
                }
                let submission = try await APIClient.shared.send(.submitHazard(request), as: HazardSubmission.self)
                remove(item.id)
                onSubmitted(submission, request)
            } catch let error as APIError where error.isConnectivityProblem {
                return
            } catch {
                update(item.id) { $0.lastError = error.localizedDescription }
            }
        }
    }

    private func update(_ id: UUID, _ change: (inout QueuedReport) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder.api.encode(items) {
            try? data.write(to: indexURL, options: .atomic)
        }
    }
}
