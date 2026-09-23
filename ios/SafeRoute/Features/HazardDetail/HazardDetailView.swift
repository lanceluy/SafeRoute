import SwiftUI
import PhotosUI
import CoreLocation

struct HazardDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = HazardDetailViewModel()

    let hazardId: UUID
    /// Observed directly so WebSocket-driven changes to this hazard refresh the screen live.
    @ObservedObject var map: MapViewModel
    var onFindSaferRoute: (() -> Void)?

    @State private var isEditingDescription = false
    @State private var descriptionDraft = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var confirmRemove = false

    var body: some View {
        NavigationStack {
            content
                .srPageBackground()
                .navigationTitle("Hazard details")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                }
                .task { await viewModel.load(hazardId: hazardId, map: map) }
                .onChange(of: map.hazards[hazardId]?.updatedAt) { _, _ in
                    Task { await viewModel.load(hazardId: hazardId, map: map) }
                }
                .onChange(of: photoItem) { _, item in
                    guard let item else { return }
                    Task {
                        if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                            await viewModel.addPhoto(image, map: map)
                        }
                        photoItem = nil
                    }
                }
                .alert("Something went wrong", isPresented: .constant(viewModel.errorMessage != nil)) {
                    Button("OK") { viewModel.errorMessage = nil }
                } message: { Text(viewModel.errorMessage ?? "") }
                .sheet(isPresented: $isEditingDescription) { descriptionEditor }
                .confirmationDialog("Remove this report as false or spam?", isPresented: $confirmRemove, titleVisibility: .visible) {
                    Button("Remove report", role: .destructive) { Task { await viewModel.moderatorRemove(map: map) } }
                } message: {
                    Text("The reporter loses reputation and commuters who disputed it gain some.")
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch (viewModel.detail, viewModel.loadState) {
        case (nil, .failed(let message)):
            ScrollView {
                SREmptyState(systemImage: "exclamationmark.triangle", title: "Couldn't load this hazard", message: message) {
                    Button("Try again") { Task { await viewModel.load(hazardId: hazardId, map: map) } }.buttonStyle(.srSecondary)
                }
                .padding(SR.Space.screenMargin)
                .padding(.top, SR.Space.xxxl)
            }
        case (nil, _):
            ProgressView("Loading hazard…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case (let detail?, _):
            detailScroll(detail)
        }
    }

    private func detailScroll(_ detail: HazardDetail) -> some View {
        let hazard = detail.hazard
        return ScrollView {
            VStack(alignment: .leading, spacing: SR.Space.md) {
                header(detail)

                if let url = APIConfig.absoluteURL(for: hazard.photoUrl) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image): image.resizable().scaledToFill()
                        case .failure: Label("Photo unavailable", systemImage: "photo").foregroundStyle(SR.Palette.textSecondary)
                        default: ProgressView()
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 180, maxHeight: 260)
                    .clipShape(RoundedRectangle(cornerRadius: SR.Radius.card, style: .continuous))
                    .accessibilityLabel("Photo of the hazard")
                }

                if let description = hazard.description, !description.isEmpty {
                    SRCard {
                        Text("Description").font(SR.Font.metaStrong).foregroundStyle(SR.Palette.textSecondary)
                        Text(description).font(SR.Font.body).foregroundStyle(SR.Palette.textPrimary)
                    }
                }

                community(detail)

                if hazard.status.isActive { stillThereCard(detail) }

                if detail.viewer.canEdit && hazard.status.isActive { yourReportCard(hazard) }

                if detail.viewer.canModerate { moderatorCard(hazard) }

                if !viewModel.timeline.isEmpty { historyCard }

                if hazard.status.isActive, let onFindSaferRoute {
                    Button { onFindSaferRoute() } label: {
                        Label("Find safer route", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                    }
                    .buttonStyle(.srPrimary)
                }
            }
            .padding(.horizontal, SR.Space.screenMargin)
            .padding(.vertical, SR.Space.md)
        }
        .refreshable { await viewModel.load(hazardId: hazardId, map: map) }
        .overlay(alignment: .bottom) {
            if let info = viewModel.infoMessage {
                ToastView(toast: Toast(message: info, systemImage: "checkmark.circle.fill", style: .success))
                    .padding(.bottom, SR.Space.md)
                    .task {
                        try? await Task.sleep(for: .seconds(3))
                        viewModel.infoMessage = nil
                    }
            }
        }
        .disabled(viewModel.isWorking)
    }

    // MARK: Cards

    private func header(_ detail: HazardDetail) -> some View {
        let hazard = detail.hazard
        let distance = Format.distance(from: LocationManager.shared.currentLocation, to: hazard.coordinate)
        return SRCard {
            HStack(spacing: SR.Space.md) {
                HazardIcon(type: hazard.type, severity: hazard.severity, size: 52)
                VStack(alignment: .leading, spacing: SR.Space.xs) {
                    Text(hazard.type.displayName).font(SR.Font.pageTitle).foregroundStyle(SR.Palette.textPrimary)
                    HStack(spacing: SR.Space.xs) {
                        SRSeverityBadge(severity: hazard.severity)
                        SRStatusBadge(status: hazard.status)
                    }
                }
            }
            if let confidence = hazard.confidence, confidence != .unknown {
                VStack(alignment: .leading, spacing: 2) {
                    Text(confidence.label).font(SR.Font.cardTitle)
                        .foregroundStyle(confidence == .contested ? SR.Palette.warning : SR.Palette.textPrimary)
                    Text(Format.confirmations(hazard.confirmationCount)).font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
                }
                .padding(.top, SR.Space.xxs)
            }
            VStack(alignment: .leading, spacing: SR.Space.xs) {
                if let distance { meta("location", "\(Format.distance(distance)) away") }
                meta("clock", "Reported \(Format.relativeInSentence(hazard.createdAt))")
                meta(detail.reporterTrustLevel.symbolName,
                     detail.viewer.isReporter ? "Reported by you" : "Reported by a \(detail.reporterTrustLevel.label)")
                if hazard.status.isActive, let expires = hazard.expiresAt {
                    let stays = "on the map for \(Format.remaining(until: expires)) unless reconfirmed"
                    let text = hazard.lastConfirmedAt.map { "Last confirmed \(Format.relativeInSentence($0)) · stays \(stays)" } ?? "Stays \(stays)"
                    meta("hourglass", text, tint: detail.expiringSoon ? SR.Palette.warning : SR.Palette.textSecondary)
                }
            }
            .padding(.top, SR.Space.xxs)
        }
        .accessibilityElement(children: .combine)
    }

    private func meta(_ symbol: String, _ text: String, tint: Color = SR.Palette.textSecondary) -> some View {
        Label(text, systemImage: symbol).font(SR.Font.secondary).foregroundStyle(tint)
    }

    private func community(_ detail: HazardDetail) -> some View {
        HStack(spacing: SR.Space.sm) {
            metricTile(value: detail.hazard.confirmationCount, label: "Confirmed", symbol: "hand.thumbsup.fill")
            metricTile(value: detail.hazard.disputeCount, label: "Disputed", symbol: "hand.thumbsdown.fill")
            if detail.community.noLongerPresentVotes > 0 {
                metricTile(value: detail.community.noLongerPresentVotes, label: "Say it's gone", symbol: "eye.slash",
                           caption: "of \(detail.community.resolutionThreshold) needed")
            }
        }
    }

    private func metricTile(value: Int, label: String, symbol: String, caption: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: SR.Space.xxs) {
            Image(systemName: symbol).foregroundStyle(SR.Palette.navy).accessibilityHidden(true)
            Text("\(value)").font(SR.Font.metric).foregroundStyle(SR.Palette.textPrimary)
            Text(caption.map { "\(label) (\($0))" } ?? label).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(SR.Space.md)
        .srCardSurface()
        .accessibilityElement(children: .combine)
    }

    private func stillThereCard(_ detail: HazardDetail) -> some View {
        SRCard {
            Text(detail.expiringSoon ? "Is this hazard still here?" : "Is it still there?")
                .font(SR.Font.cardTitle)
                .foregroundStyle(detail.expiringSoon ? SR.Palette.warning : SR.Palette.textPrimary)
            HStack(spacing: SR.Space.sm) {
                Button { Task { await viewModel.stillHere(map: map) } } label: {
                    Label("Still here", systemImage: "eye.fill")
                }
                .buttonStyle(.srPrimary)
                .accessibilityHint(detail.viewer.isReporter ? "Keeps your report from expiring" : "Confirms this hazard")

                Button { Task { await viewModel.vote(.noLongerPresent, map: map) } } label: {
                    Label("No longer here", systemImage: "eye.slash")
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .buttonStyle(.srSecondary)
            }
            if detail.viewer.isReporter {
                Text("You reported this hazard, so other commuters confirm or dispute it.")
                    .font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
            } else {
                if let mine = detail.viewer.confirmation {
                    Text(mine == .verify ? "You confirmed this hazard. You can change your mind any time."
                                         : "You disputed this report. Tap “Still here” if it turns out to be real.")
                        .font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                }
                if detail.viewer.confirmation != .dispute {
                    Button { Task { await viewModel.setConfirmation(.dispute, map: map) } } label: {
                        Label("This report isn't accurate", systemImage: "hand.thumbsdown")
                            .font(SR.Font.secondary.weight(.medium))
                            .foregroundStyle(SR.Palette.textSecondary)
                            .frame(minHeight: SR.Layout.minTouchTarget)
                    }
                }
            }
        }
    }

    private func yourReportCard(_ hazard: Hazard) -> some View {
        SRCard(padding: SR.Space.md) {
            SRSectionHeader(title: "Your report")
            Button {
                descriptionDraft = hazard.description ?? ""
                isEditingDescription = true
            } label: {
                SRListRow(title: "Edit description", systemImage: "pencil")
            }
            .buttonStyle(.plain)
            Divider()
            PhotosPicker(selection: $photoItem, matching: .images) {
                SRListRow(title: hazard.photoUrl == nil ? "Add photo" : "Replace photo", systemImage: "camera")
            }
            .buttonStyle(.plain)
        }
    }

    private func moderatorCard(_ hazard: Hazard) -> some View {
        SRCard(padding: SR.Space.md) {
            SRSectionHeader(title: "Moderator")
            if hazard.status.isActive {
                Button { Task { await viewModel.moderatorResolve(map: map) } } label: {
                    SRListRow(title: "Resolve now", systemImage: "checkmark.shield", showsChevron: false)
                }
                Divider()
                Button { confirmRemove = true } label: {
                    SRListRow(title: "Remove as false or spam", systemImage: "trash", tint: SR.Palette.critical, showsChevron: false)
                }
            } else {
                Button { Task { await viewModel.moderatorReopen(map: map) } } label: {
                    SRListRow(title: "Reopen", systemImage: "arrow.uturn.backward", showsChevron: false)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var historyCard: some View {
        SRCard(padding: SR.Space.md) {
            SRSectionHeader(title: "History")
            ForEach(viewModel.timeline) { entry in
                HStack(alignment: .top, spacing: SR.Space.sm) {
                    Image(systemName: entry.symbolName)
                        .font(SR.Font.meta)
                        .foregroundStyle(SR.Palette.navy)
                        .frame(width: 28, height: 28)
                        .background(SR.Palette.navyTint, in: Circle())
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.title).font(SR.Font.body).foregroundStyle(SR.Palette.textPrimary)
                        Text(Format.timestamp(entry.at)).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                        if let note = entry.displayNote {
                            Text(note).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var descriptionEditor: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: SR.Space.sm) {
                TextField("What should other commuters know?", text: $descriptionDraft, axis: .vertical)
                    .lineLimit(3...8)
                    .font(SR.Font.body)
                    .padding(SR.Space.md)
                    .srCardSurface(radius: SR.Radius.button)
                Spacer()
            }
            .padding(SR.Space.screenMargin)
            .srPageBackground()
            .navigationTitle("Edit description")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isEditingDescription = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        isEditingDescription = false
                        Task { await viewModel.saveDescription(descriptionDraft, map: map) }
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
