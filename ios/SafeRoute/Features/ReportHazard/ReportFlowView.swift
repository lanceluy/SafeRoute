import SwiftUI
import MapKit
import PhotosUI

/// Guided report: WHAT → WHERE → EVIDENCE → DETAILS → REVIEW (review §26), with a duplicate
/// check before submitting (review §11).
struct ReportFlowView: View {
    enum Step: Int, CaseIterable {
        case what, location, evidence, details, review

        var title: String {
            switch self {
            case .what: return "What did you see?"
            case .location: return "Where is it?"
            case .evidence: return "Add a photo"
            case .details: return "Details"
            case .review: return "Review"
            }
        }
    }

    @EnvironmentObject private var appState: AppState
    @ObservedObject private var places = PlaceNameCache.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var step: Step = .what
    @State private var type: HazardType?
    @State private var coordinate: CLLocationCoordinate2D
    @State private var camera: MapCameraPosition
    @State private var photoItem: PhotosPickerItem?
    @State private var photo: UIImage?
    @State private var severityAnswer: String?
    @State private var descriptionText = ""
    @State private var duplicate: Hazard?
    @State private var isBusy = false
    @State private var errorMessage: String?

    init() {
        let start = LocationManager.shared.currentLocation ?? CLLocationCoordinate2D(latitude: 14.5547, longitude: 121.0244)
        _coordinate = State(initialValue: start)
        _camera = State(initialValue: .region(MKCoordinateRegion(center: start, latitudinalMeters: 250, longitudinalMeters: 250)))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: SR.Space.xs) {
                    Text("Step \(step.rawValue + 1) of \(Step.allCases.count)")
                        .font(SR.Font.metaStrong)
                        .foregroundStyle(SR.Palette.textSecondary)
                    ProgressView(value: Double(step.rawValue + 1), total: Double(Step.allCases.count))
                        .tint(SR.Palette.navy)
                }
                .padding(.horizontal, SR.Space.screenMargin)
                .padding(.vertical, SR.Space.xs)
                .accessibilityElement(children: .combine)
                Group {
                    switch step {
                    case .what: whatStep
                    case .location: locationStep
                    case .evidence: evidenceStep
                    case .details: detailsStep
                    case .review: reviewStep
                    }
                }
                .frame(maxHeight: .infinity, alignment: .top)
                footer
            }
            .srPageBackground()
            .navigationTitle(step.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if step != .what {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Back") { go(to: Step(rawValue: step.rawValue - 1)!) }
                    }
                }
            }
            .alert("Couldn't continue", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
            .sheet(item: $duplicate) { match in duplicateSheet(match) }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) { photo = UIImage(data: data) }
                }
            }
        }
        .interactiveDismissDisabled(type != nil)
    }

    // MARK: Steps

    private var whatStep: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: SR.Space.sm)], spacing: SR.Space.sm) {
                ForEach(HazardType.reportable) { option in
                    Button {
                        type = option
                        severityAnswer = nil
                        go(to: .location)
                    } label: {
                        VStack(alignment: .leading, spacing: SR.Space.xs) {
                            Image(systemName: option.symbolName)
                                .font(.title2)
                                .foregroundStyle(SR.Palette.navy)
                                .frame(width: 44, height: 44)
                                .background(SR.Palette.navyTint, in: RoundedRectangle(cornerRadius: SR.Radius.control, style: .continuous))
                            Text(option.displayName).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                            Text(option.shortDescription).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading)
                        .padding(SR.Space.md)
                        .srCardSurface()
                        .overlay(RoundedRectangle(cornerRadius: SR.Radius.card, style: .continuous)
                            .strokeBorder(type == option ? SR.Palette.navy : .clear, lineWidth: 2))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(option.displayName). \(option.shortDescription)")
                }
            }
            .padding(.horizontal, SR.Space.screenMargin)
            .padding(.vertical, SR.Space.md)
        }
    }

    private var locationStep: some View {
        VStack(spacing: 12) {
            ZStack {
                Map(position: $camera) { UserAnnotation() }
                    .onMapCameraChange(frequency: .continuous) { context in coordinate = context.region.center }
                    .mapControls { MapCompass() }
                // The pin stays centered; the user drags the map underneath it.
                Image(systemName: "mappin")
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(.red)
                    .offset(y: -20)
                    .accessibilityHidden(true)
            }
            .clipShape(RoundedRectangle(cornerRadius: SR.Radius.card, style: .continuous))
            .padding(.horizontal, SR.Space.screenMargin)
            .accessibilityLabel("Map. Drag to place the pin exactly where the hazard is.")

            Text("Drag the map so the pin sits exactly on the hazard.")
                .font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
            Button {
                if let here = LocationManager.shared.currentLocation {
                    camera = .region(MKCoordinateRegion(center: here, latitudinalMeters: 250, longitudinalMeters: 250))
                    coordinate = here
                }
            } label: {
                Label("Use my current location", systemImage: "location.fill")
            }
            .font(SR.Font.secondary.weight(.semibold))
            .foregroundStyle(SR.Palette.navy)
            .frame(minHeight: SR.Layout.minTouchTarget)
            if !isInCoverage {
                StateBanner(text: "SafeRoute is currently available in the \(appState.meta.coverage?.name ?? "pilot area") only.",
                            systemImage: "mappin.slash", tint: .orange,
                            actionTitle: "Go there") {
                    if let center = appState.meta.coverage?.center {
                        camera = .region(MKCoordinateRegion(center: center, latitudinalMeters: 2000, longitudinalMeters: 2000))
                    }
                }
                .padding(.horizontal, SR.Space.screenMargin)
            }
        }
        .padding(.bottom, SR.Space.xs)
    }

    private var evidenceStep: some View {
        VStack(spacing: SR.Space.md) {
            if let photo {
                Image(uiImage: photo)
                    .resizable().scaledToFit()
                    .frame(maxHeight: 300)
                    .clipShape(RoundedRectangle(cornerRadius: SR.Radius.card, style: .continuous))
                    .accessibilityLabel("Selected photo")
                Button(role: .destructive) { self.photo = nil; photoItem = nil } label: {
                    Label("Remove photo", systemImage: "trash")
                }
                .foregroundStyle(SR.Palette.critical)
                .frame(minHeight: SR.Layout.minTouchTarget)
            } else {
                SREmptyState(systemImage: "camera.viewfinder", title: "A photo helps others trust your report",
                             message: "Optional. Location data is removed from photos before they're stored.")
            }
            // PhotosPicker's label closure is @Sendable, so compute the title outside it.
            let pickerTitle = photo == nil ? "Choose photo" : "Choose a different photo"
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label(pickerTitle, systemImage: "photo.on.rectangle")
            }
            .buttonStyle(.srSecondary)
        }
        .padding(SR.Space.screenMargin)
    }

    private var detailsStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SR.Space.xl) {
                if let type, let question = appState.meta.questions[type] {
                    VStack(alignment: .leading, spacing: SR.Space.sectionTitleToCard) {
                        SRSectionHeader(title: question.prompt)
                        SRCard(padding: SR.Space.md) {
                            ForEach(Array(question.options.enumerated()), id: \.element.id) { index, option in
                                if index > 0 { Divider() }
                                Button {
                                    severityAnswer = severityAnswer == option.value ? nil : option.value
                                } label: {
                                    HStack(spacing: SR.Space.sm) {
                                        Image(systemName: severityAnswer == option.value ? "largecircle.fill.circle" : "circle")
                                            .foregroundStyle(severityAnswer == option.value ? SR.Palette.navy : SR.Palette.textTertiary)
                                            .accessibilityHidden(true)
                                        Text(option.label).font(SR.Font.body).foregroundStyle(SR.Palette.textPrimary)
                                        Spacer()
                                        SRSeverityBadge(severity: option.severity, compact: true)
                                    }
                                    .frame(minHeight: SR.Layout.minTouchTarget)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(severityAnswer == option.value ? .isSelected : [])
                            }
                        }
                        Text("Your answer sets how severe the hazard is shown to others.")
                            .font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                    }
                }
                VStack(alignment: .leading, spacing: SR.Space.sectionTitleToCard) {
                    SRSectionHeader(title: "Description (optional)")
                    TextField("What should other commuters know?", text: $descriptionText, axis: .vertical)
                        .lineLimit(3...6)
                        .font(SR.Font.body)
                        .padding(SR.Space.md)
                        .srCardSurface(radius: SR.Radius.button)
                }
            }
            .padding(.horizontal, SR.Space.screenMargin)
            .padding(.vertical, SR.Space.md)
        }
    }

    private var reviewStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SR.Space.md) {
                SRCard(padding: SR.Space.md) {
                    if let type {
                        HStack(spacing: SR.Space.sm) {
                            HazardIcon(type: type, severity: selectedSeverity ?? .medium, size: 40)
                            Text(type.displayName).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                        }
                        Divider()
                    }
                    SRListRow(title: "Location", value: places.name(for: coordinate)
                              ?? String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude), showsChevron: false)
                    Divider()
                    SRListRow(title: "Photo", value: photo == nil ? "None" : "Attached", showsChevron: false)
                    if let type, let answer = severityAnswer,
                       let option = appState.meta.questions[type]?.options.first(where: { $0.value == answer }) {
                        Divider()
                        SRListRow(title: "Severity", value: "\(option.label) · \(option.severity.shortLabel)", showsChevron: false)
                    }
                    if !descriptionText.isEmpty {
                        Divider()
                        Text(descriptionText).font(SR.Font.body).foregroundStyle(SR.Palette.textPrimary)
                    }
                }
                Text("Commuters nearby will see your report. They confirm or dispute it — you can't confirm your own. If someone already reported the same hazard, your report is added to theirs.")
                    .font(SR.Font.meta)
                    .foregroundStyle(SR.Palette.textSecondary)
            }
            .padding(.horizontal, SR.Space.screenMargin)
            .padding(.vertical, SR.Space.md)
        }
    }

    private var selectedSeverity: Severity? {
        guard let type, let answer = severityAnswer else { return nil }
        return appState.meta.questions[type]?.options.first { $0.value == answer }?.severity
    }

    // MARK: Footer & navigation

    private var footer: some View {
        Group {
            switch step {
            case .what:
                EmptyView()
            case .location:
                Button {
                    Task { await checkForDuplicates() }
                } label: {
                    if isBusy { ProgressView() } else { Text("Confirm location") }
                }
                .buttonStyle(.srPrimary)
                .disabled(isBusy || !isInCoverage)
            case .evidence:
                Button(photo == nil ? "Skip" : "Next") { go(to: .details) }.buttonStyle(.srPrimary)
            case .details:
                Button("Next") { go(to: .review) }.buttonStyle(.srPrimary)
            case .review:
                Button {
                    Task { await submit() }
                } label: {
                    if isBusy { ProgressView().tint(SR.Palette.onNavy) } else { Text("Submit report") }
                }
                .buttonStyle(.srPrimary)
                .disabled(isBusy)
            }
        }
        .padding(.horizontal, SR.Space.screenMargin)
        .padding(.vertical, SR.Space.sm)
    }

    private var isInCoverage: Bool {
        appState.meta.coverage?.contains(coordinate) ?? true
    }

    private func go(to next: Step) {
        if reduceMotion { step = next } else { withAnimation { step = next } }
    }

    private func checkForDuplicates() async {
        guard let type else { return }
        isBusy = true
        defer { isBusy = false }
        let matches = try? await APIClient.shared.send(
            .nearby(lat: coordinate.latitude, lon: coordinate.longitude, radiusMeters: 50, types: [type]), as: [Hazard].self)
        if let match = matches?.first {
            duplicate = match
        } else {
            go(to: .evidence)
        }
    }

    private func duplicateSheet(_ match: Hazard) -> some View {
        let distance = Format.distance(from: coordinate, to: match.coordinate) ?? 0
        let isMine = match.reporterId == appState.currentUser?.id
        return VStack(alignment: .leading, spacing: SR.Space.md) {
            VStack(alignment: .leading, spacing: SR.Space.xxs) {
                Text("Someone may have already reported this").font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                Text("If it's the same hazard, your confirmation helps others trust it.")
                    .font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
            }
            SRCard(padding: SR.Space.md) {
                HStack(spacing: SR.Space.sm) {
                    HazardIcon(type: match.type, severity: match.severity, size: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(match.type.displayName).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                        Text("\(Format.distance(distance)) away · Reported \(Format.relativeInSentence(match.createdAt))")
                            .font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
                        Text(isMine ? "You reported this" : Format.confirmations(match.confirmationCount))
                            .font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            Button {
                Task { await confirmExisting(match, isMine: isMine) }
            } label: {
                Text("Yes, this is the same hazard")
            }
            .buttonStyle(.srPrimary)
            Button {
                duplicate = nil
                go(to: .evidence)
            } label: {
                Text("Report a different hazard")
            }
            .buttonStyle(.srSecondary)
        }
        .padding(SR.Space.screenMargin)
        .srPageBackground()
        .presentationDetents([.medium])
    }

    private func confirmExisting(_ match: Hazard, isMine: Bool) async {
        do {
            if isMine {
                _ = try await APIClient.shared.send(.resolutionVote(id: match.id, action: .stillPresent), as: CommandAccepted.self)
                appState.show(Toast(message: "Thanks — your report stays on the map a while longer.", systemImage: "checkmark.circle.fill", style: .success))
            } else {
                _ = try await APIClient.shared.send(.setConfirmation(id: match.id, action: .verify), as: CommandAccepted.self)
                appState.show(Toast(message: "Thanks — your confirmation was added to the existing report.", systemImage: "hand.thumbsup.fill", style: .success))
            }
            duplicate = nil
            dismiss()
        } catch {
            duplicate = nil
            errorMessage = error.localizedDescription
        }
    }

    private func submit() async {
        guard let type else { return }
        isBusy = true
        defer { isBusy = false }
        let request = HazardSubmissionRequest(
            type: type, latitude: coordinate.latitude, longitude: coordinate.longitude,
            description: descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : descriptionText,
            photoUrl: nil, severityAnswer: severityAnswer)
        if await appState.submitReport(request, imageData: photo?.preparedForUpload()) {
            dismiss()
        }
    }
}
