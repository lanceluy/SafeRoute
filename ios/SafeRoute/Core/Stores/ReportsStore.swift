import Foundation
import CoreLocation

/// "My Reports" plus the lifecycle of reports still being processed. A just-submitted report is
/// shown as a temporary pin until the backend says whether it CREATED a hazard or MERGED into
/// an existing one; the pin is then replaced with the canonical hazard.
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

    /// The last page successfully loaded.
    private var page = 0
    private var pollTasks: [UUID: Task<Void, Never>] = [:]
    /// Bumped on sign-out so responses to the previous session's requests are dropped.
    private var generation = 0

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
            // Still queued after ~2 minutes (e.g. the event bus is down; the report is safe in the
            // server's outbox). Stop the temporary pin; My Reports keeps showing it as Processing.
            guard let self, self.pending.removeValue(forKey: submission.submissionId) != nil else { return }
            self.pollTasks[submission.submissionId] = nil
            await self.load(reset: true)
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
        await load(page: reset ? 0 : page + 1)
    }

    func loadMore() async {
        guard hasMore, !loadState.isLoading else { return }
        await load(reset: false)
    }

    /// The page cursor only advances when the page actually arrived, so a failed "load more"
    /// retries the same page instead of skipping it.
    private func load(page requested: Int) async {
        if loadState.isLoading { return }
        let generation = self.generation
        loadState = .loading
        do {
            let result = try await APIClient.shared.send(.myReports(page: requested), as: PageResponse<MyReport>.self)
            guard generation == self.generation else { return }
            reports = requested == 0 ? result.items : reports + result.items
            page = requested
            hasMore = result.hasMore
            loadState = .loaded
        } catch {
            guard generation == self.generation else { return }
            loadState = .failed(error.localizedDescription)
        }
    }

    func reset() {
        generation += 1
        page = 0
        hasMore = false
        pollTasks.values.forEach { $0.cancel() }
        pollTasks = [:]
        pending = [:]
        reports = []
        loadState = .idle
    }
}
