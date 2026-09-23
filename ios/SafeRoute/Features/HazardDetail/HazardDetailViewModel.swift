import Foundation
import UIKit

@MainActor
final class HazardDetailViewModel: ObservableObject {
    @Published private(set) var detail: HazardDetail?
    @Published private(set) var timeline: [TimelineEntry] = []
    @Published private(set) var loadState: LoadState = .idle
    @Published private(set) var isWorking = false
    @Published var errorMessage: String?
    @Published var infoMessage: String?

    func load(hazardId: UUID, map: MapViewModel) async {
        if detail == nil { loadState = .loading }
        do {
            async let detailCall = APIClient.shared.send(.hazard(id: hazardId), as: HazardDetail.self)
            async let timelineCall = APIClient.shared.send(.history(id: hazardId), as: [TimelineEntry].self)
            let (d, t) = try await (detailCall, timelineCall)
            detail = d
            timeline = t.reversed() // newest first
            map.upsert(d.hazard)
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    /// "Still here" for other users is a VERIFY; for the reporter it's a STILL_PRESENT vote
    /// (they can't confirm their own report, but they can keep it from expiring).
    func stillHere(map: MapViewModel) async {
        guard let detail else { return }
        if detail.viewer.isReporter {
            await vote(.stillPresent, map: map)
        } else {
            await setConfirmation(.verify, map: map)
        }
    }

    func setConfirmation(_ action: ConfirmationAction, map: MapViewModel) async {
        guard var current = detail else { return }
        await perform(map: map) {
            _ = try await APIClient.shared.send(.setConfirmation(id: current.hazard.id, action: action), as: CommandAccepted.self)
            // Optimistic: reflect the user's opinion now; counts/status arrive via WebSocket.
            let previous = current.viewer.confirmation
            current.viewer = .init(isReporter: false, confirmation: action, resolutionVote: current.viewer.resolutionVote,
                                   canEdit: current.viewer.canEdit, canModerate: current.viewer.canModerate)
            if previous != action {
                if action == .verify { current.hazard.confirmationCount += 1 } else { current.hazard.disputeCount += 1 }
                if previous == .verify { current.hazard.confirmationCount -= 1 }
                if previous == .dispute { current.hazard.disputeCount -= 1 }
            }
            self.detail = current
            self.infoMessage = action == .verify ? "Thanks — your confirmation was recorded." : "Thanks — your dispute was recorded."
        }
    }

    func vote(_ action: ResolutionAction, map: MapViewModel) async {
        guard let current = detail else { return }
        await perform(map: map) {
            _ = try await APIClient.shared.send(.resolutionVote(id: current.hazard.id, action: action), as: CommandAccepted.self)
            self.infoMessage = action == .noLongerPresent
                ? "Thanks — once enough commuters agree, it'll be marked resolved."
                : "Thanks — this keeps the hazard on the map for others."
        }
    }

    func saveDescription(_ text: String, map: MapViewModel) async {
        guard let current = detail else { return }
        await perform(map: map) {
            let updated = try await APIClient.shared.send(.updateHazard(id: current.hazard.id, description: text), as: Hazard.self)
            self.detail?.hazard = updated
        }
    }

    func addPhoto(_ image: UIImage, map: MapViewModel) async {
        guard let current = detail, let jpeg = image.preparedForUpload() else { return }
        await perform(map: map) {
            let stored = try await APIClient.shared.send(.uploadHazardImage(jpeg: jpeg), as: StoredImage.self)
            let updated = try await APIClient.shared.send(.updateHazard(id: current.hazard.id, photoUrl: stored.url), as: Hazard.self)
            self.detail?.hazard = updated
        }
    }

    func moderatorResolve(map: MapViewModel) async {
        guard let current = detail else { return }
        await perform(map: map) {
            _ = try await APIClient.shared.send(.moderatorResolve(id: current.hazard.id, note: "Resolved by moderator"), as: CommandAccepted.self)
            self.infoMessage = "Resolution queued."
        }
    }

    func moderatorReopen(map: MapViewModel) async {
        guard let current = detail else { return }
        await perform(map: map) {
            _ = try await APIClient.shared.send(.moderatorReopen(id: current.hazard.id), as: Hazard.self)
        }
    }

    func moderatorRemove(map: MapViewModel) async {
        guard let current = detail else { return }
        await perform(map: map) {
            _ = try await APIClient.shared.send(.moderatorRemove(id: current.hazard.id, reason: "False or spam report"), as: Hazard.self)
        }
    }

    private func perform(map: MapViewModel, _ work: () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await work()
            if let id = detail?.hazard.id {
                // Give the Kafka consumer a moment, then refresh the authoritative state.
                try? await Task.sleep(for: .milliseconds(800))
                await load(hazardId: id, map: map)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

extension UIImage {
    /// JPEG under the 5 MB server limit, longest side ≤ 1600 px (the server re-encodes anyway).
    func preparedForUpload() -> Data? {
        let maxSide: CGFloat = 1600
        let scale = min(1, maxSide / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: target)
        let resized = renderer.image { _ in draw(in: CGRect(origin: .zero, size: target)) }
        return resized.jpegData(compressionQuality: 0.8)
    }
}
