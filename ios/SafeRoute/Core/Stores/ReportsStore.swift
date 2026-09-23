import Foundation
import CoreLocation

/// "My Reports" plus the lifecycle of reports still being processed. A just-submitted report is
/// shown as a temporary pin until the backend says whether it CREATED a hazard or MERGED into
/// an existing one; the pin is then replaced with the canonical hazard (review §10).
@MainActor
final class ReportsStore: ObservableObject {
    struct PendingSubmission: Identifiable {
        let id: UUID
        let request: HazardSubmissionRequest
        let submittedAt: Date

        var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: request.latitude, longitude: request.longitude) }
    }

    @Published private(set) var reports: [MyReport] = []
    @Published private(set) var loadState: LoadState = .idle
    @Published private(set) var hasMore = false
    @Published private(set) var pending: [UUID: PendingSubmission] = [:]

    /// Called with (outcome, canonical hazard id, message) when a submission finishes.
    var onSubmissionFinished: ((SubmissionStatus, UUID?, String) -> Void)?

    private var page = 0
    private var pollTasks: [UUID: Task<Void, Never>] = [:]

    func track(_ submission: HazardSubmission, request: HazardSubmissionRequest) {
        pending[submission.submissionId] = PendingSubmission(id: submission.submissionId, request: request, submittedAt: Date())
        // WebSocket normally delivers submission_processed first; polling is the fallback when
        // the socket is reconnecting.
        pollTasks[submission.submissionId] = Task { [weak self] in
            for _ in 0..<40 {
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled, let self, self.pending[submission.submissionId] != nil else { return }
                if let latest = try? await APIClient.shared.send(.submission(id: submission.submissionId), as: HazardSubmission.self),
                   latest.status.isTerminal {
                    self.finish(submissionId: latest.submissionId, status: latest.status, hazardId: latest.hazardId, message: nil)
                    return
                }
            }
        }
        Task { await load(reset: true) }
    }

    func handle(_ frame: SubmissionProcessedFrame) {
        finish(submissionId: frame.submissionId, status: frame.status, hazardId: frame.hazardId, message: frame.message)
    }

    private func finish(submissionId: UUID, status: SubmissionStatus, hazardId: UUID?, message: String?) {
        guard pending.removeValue(forKey: submissionId) != nil else { return } // already handled (frame + poll)
        pollTasks.removeValue(forKey: submissionId)?.cancel()
        let text: String
        switch status {
        case .created: text = message ?? "Report published"
        case .merged: text = message ?? "Your report matched an existing hazard. Your confirmation was added to that report."
        default: text = message ?? "We couldn't process this report. Please try again."
        }
        onSubmissionFinished?(status, hazardId, text)
        Task { await load(reset: true) }
    }

    func load(reset: Bool) async {
        if loadState.isLoading { return }
        if reset { page = 0 }
        loadState = .loading
        do {
            let result = try await APIClient.shared.send(.myReports(page: page), as: PageResponse<MyReport>.self)
            reports = reset ? result.items : reports + result.items
            hasMore = result.hasMore
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    func loadMore() async {
        guard hasMore, !loadState.isLoading else { return }
        page += 1
        await load(reset: false)
    }

    func reset() {
        pollTasks.values.forEach { $0.cancel() }
        pollTasks = [:]
        pending = [:]
        reports = []
        loadState = .idle
    }
}
