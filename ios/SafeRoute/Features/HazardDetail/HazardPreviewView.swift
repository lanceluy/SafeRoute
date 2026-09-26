import SwiftUI

/// The step between the Nearby Hazards list and the full hazard screen: what a commuter needs
/// to decide and act — severity, distance, recency, trust, photo, description — plus the
/// crowdsourcing actions. History, reporter context and moderation stay in HazardDetailView.
struct HazardPreviewView: View {
    let hazardId: UUID
    let distance: Double?
    /// Observed so WebSocket changes (new confirmations, resolution) show up live.
    @ObservedObject var map: MapViewModel
    let onOpenFullDetails: () -> Void

    @StateObject private var viewModel = HazardDetailViewModel()

    /// The list's copy shows at once; the loaded detail adds viewer state and replaces it.
    private var hazard: Hazard? { viewModel.detail?.hazard ?? map.hazards[hazardId] }

    var body: some View {
        ScrollView {
            if let hazard {
                VStack(alignment: .leading, spacing: SR.Space.lg) {
                    header(hazard)
                    facts(hazard)
                    if let url = APIConfig.absoluteURL(for: hazard.photoUrl) { photo(url) }
                    if let description = hazard.description, !description.isEmpty {
                        Text(description)
                            .font(SR.Font.body)
                            .foregroundStyle(SR.Palette.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if hazard.status.isActive { actions }
                    Button(action: onOpenFullDetails) {
                        HStack {
                            Text("View full details")
                            Spacer()
                            Image(systemName: "chevron.right")
                        }
                        .font(SR.Font.secondary.weight(.semibold))
                        .foregroundStyle(SR.Palette.navy)
                        .frame(minHeight: SR.Layout.minTouchTarget)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("History, verification timeline and exact location")
                }
                .padding(.horizontal, SR.Space.screenMargin)
                .padding(.top, SR.Space.xs)
                .padding(.bottom, SR.Space.xxl)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(SR.Space.xxl)
            }
        }
        .srPageBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load(hazardId: hazardId, map: map) }
    }

    private func header(_ hazard: Hazard) -> some View {
        HStack(alignment: .top, spacing: SR.Space.sm) {
            CategoryIcon(type: hazard.type, size: 44)
            VStack(alignment: .leading, spacing: SR.Space.xs) {
                Text(hazard.type.displayName)
                    .font(SR.Font.greeting)
                    .foregroundStyle(SR.Palette.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                SeverityBadge(severity: hazard.severity)
            }
        }
    }

    private func facts(_ hazard: Hazard) -> some View {
        VStack(alignment: .leading, spacing: SR.Space.xs) {
            if let distance {
                fact("location.fill", [ "\(Format.distance(distance)) away", NearbyHazardList.walkingTime(distance)]
                        .compactMap { $0 }.joined(separator: " · "))
            }
            fact("clock", "Reported \(Format.ago(hazard.createdAt).lowercased())")
            fact(hazard.status == .verified ? "checkmark.seal.fill" : "person.2.fill", NearbyHazardList.detailedTrust(hazard))
            if NearbyHazardList.isPossiblyOutdated(hazard) {
                fact("exclamationmark.circle", "Possibly outdated: no one has confirmed it recently")
            }
        }
        .font(SR.Font.secondary)
        .foregroundStyle(SR.Palette.textSecondary)
    }

    private func fact(_ symbol: String, _ text: String) -> some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: symbol).foregroundStyle(SR.Palette.navy)
        }
    }

    private func photo(_ url: URL) -> some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFill()
            case .failure: Label("Photo unavailable", systemImage: "photo").foregroundStyle(SR.Palette.textSecondary)
            default: ProgressView()
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160, maxHeight: 200)
        .background(SR.Palette.fill)
        .clipShape(RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
        .accessibilityLabel("Photo of the hazard")
    }

    /// Confirm / Dispute, using the same rules as the full screen: a reporter can't confirm their
    /// own report, but "Still here" keeps it from expiring.
    @ViewBuilder
    private var actions: some View {
        VStack(alignment: .leading, spacing: SR.Space.xs) {
            if let detail = viewModel.detail {
                HStack(spacing: SR.Space.sm) {
                    Button { Task { await viewModel.stillHere(map: map) } } label: {
                        Label(detail.viewer.isReporter ? "Still here" : "Confirm hazard", systemImage: "checkmark")
                            .lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .buttonStyle(.srPrimary)
                    if !detail.viewer.isReporter {
                        Button { Task { await viewModel.setConfirmation(.dispute, map: map) } } label: {
                            Label("Dispute", systemImage: "hand.thumbsdown")
                                .lineLimit(1).minimumScaleFactor(0.8)
                        }
                        .buttonStyle(.srSecondary)
                    }
                }
                .disabled(viewModel.isWorking)
                if let message = viewModel.errorMessage ?? viewModel.infoMessage ?? viewerNote(detail) {
                    Text(message)
                        .font(SR.Font.meta)
                        .foregroundStyle(viewModel.errorMessage != nil ? SR.Palette.critical : SR.Palette.textSecondary)
                }
            } else if case .failed(let message) = viewModel.loadState {
                Text("Couldn't load actions: \(message)")
                    .font(SR.Font.meta)
                    .foregroundStyle(SR.Palette.textSecondary)
            } else {
                ProgressView()
            }
        }
    }

    private func viewerNote(_ detail: HazardDetail) -> String? {
        if detail.viewer.isReporter { return "You reported this hazard, so other commuters confirm or dispute it." }
        switch detail.viewer.confirmation {
        case .verify: return "You confirmed this hazard."
        case .dispute: return "You disputed this report."
        default: return nil
        }
    }
}
