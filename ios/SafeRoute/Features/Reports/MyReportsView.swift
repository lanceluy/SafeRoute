import SwiftUI
import CoreLocation

/// Closes the feedback loop: every report, what happened to it, and what the community did.
struct MyReportsView: View {
    enum Segment: String, CaseIterable, Identifiable {
        case all = "All", processing = "Processing", active = "Active", closed = "Closed"
        var id: String { rawValue }
    }

    @EnvironmentObject private var appState: AppState
    @ObservedObject var store: ReportsStore
    @ObservedObject var queue: OfflineReportQueue
    @ObservedObject private var places = PlaceNameCache.shared
    @ObservedObject private var location = LocationManager.shared
    @StateObject private var nearby = NearbyHazardsModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var segment: Segment = .all
    @State private var selected: SelectedHazard?
    @State private var activeFilter = ActiveHazardsFilter.load()
    @State private var isShowingActiveFilters = false

    var body: some View {
        NavigationStack {
            SRScrollPage {
                VStack(alignment: .leading, spacing: SR.Space.md) {
                    SRPageHeader("My Reports", subtitle: "Track your contributions")
                    chips
                    if segment == .active { activeControls }
                }
                if segment == .active { activeContent } else { content }
            }
            .refreshable {
                await store.load(reset: true)
                if segment == .active, activeFilter.scope == .nearby, let here = location.currentLocation {
                    await nearby.load(around: here, filter: activeFilter, force: true)
                }
            }
            .onChange(of: activeFilter) { _, filter in filter.save() }
            .task(id: nearbyQueryKey) {
                guard segment == .active, activeFilter.scope == .nearby, let here = location.currentLocation else { return }
                await nearby.load(around: here, filter: activeFilter)
            }
            .sheet(isPresented: $isShowingActiveFilters) { ActiveFilterSheet(filter: $activeFilter) }
            #if DEBUG
            .onAppear {
                // Screenshot automation: SAFEROUTE_DEMO_SEGMENT=active, SAFEROUTE_DEMO_SCOPE=mine|nearby|filters
                let env = ProcessInfo.processInfo.environment
                if env["SAFEROUTE_DEMO_SEGMENT"] == "active" { segment = .active }
                switch env["SAFEROUTE_DEMO_SCOPE"] {
                case "nearby": activeFilter.scope = .nearby
                case "mine": activeFilter.scope = .mine
                case "filters": isShowingActiveFilters = true
                default: break
                }
            }
            #endif
            .task { if store.loadState == .idle { await store.load(reset: true) } }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(item: $selected) { HazardDetailView(hazardId: $0.id, map: appState.map) }
        }
    }

    // MARK: Chips with counts

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: SR.Space.xs) {
                ForEach(Segment.allCases) { s in
                    SRFilterChip(title: s.rawValue, count: s == .all ? nil : count(s), isSelected: segment == s) {
                        withAnimation(SR.Motion.standard(reduceMotion: reduceMotion)) { segment = s }
                    }
                }
            }
        }
        .scrollClipDisabled()
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let items = reports(in: segment)
        let queued = segment == .all || segment == .processing ? queue.items : []

        if store.reports.isEmpty && queue.items.isEmpty {
            overallEmptyState
        } else if items.isEmpty && queued.isEmpty {
            segmentEmptyState
        } else {
            LazyVStack(alignment: .leading, spacing: SR.Space.betweenCards) {
                ForEach(queued) { item in queuedCard(item) }
                ForEach(items) { report in
                    Button { if let id = report.hazard?.id { selected = SelectedHazard(id: id) } } label: {
                        ReportCard(report: report, place: places.name(for: CLLocationCoordinate2D(
                            latitude: report.submission.latitude, longitude: report.submission.longitude)))
                    }
                    .buttonStyle(.plain)
                    .disabled(report.hazard == nil)
                    .task { if report.id == store.reports.last?.id { await store.loadMore() } }
                }
                if store.loadState.isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(SR.Space.md)
                }
            }
        }
    }

    @ViewBuilder
    private var overallEmptyState: some View {
        switch store.loadState {
        case .loading, .idle:
            SRCard { HStack { ProgressView(); Text("Loading your reports…").foregroundStyle(SR.Palette.textSecondary) } }
        case .failed(let message):
            SREmptyState(systemImage: "wifi.exclamationmark", title: "Couldn't load your reports", message: message) {
                Button("Try again") { Task { await store.load(reset: true) } }.buttonStyle(.srSecondary)
            }
            .padding(.top, SR.Space.xxxl)
        case .loaded:
            SREmptyState(systemImage: "figure.walk",
                         title: "You haven't reported any hazards yet",
                         message: "Help other commuters by reporting unsafe walkways. Your reports and what the community says about them will appear here.") {
                reportButton
            }
            .padding(.top, SR.Space.xxxl)
        }
    }

    /// Explains what to expect and points to where the reports are.
    private var segmentEmptyState: some View {
        let copy: (title: String, message: String) = switch segment {
        case .processing: ("Nothing processing", "New reports show here for a moment while SafeRoute checks whether someone already reported the same hazard.")
        case .active: ("No active reports", "Your reported hazards will appear here while they're still affecting commuters.")
        case .closed: ("No closed reports", "Hazards you reported move here once they're resolved or no longer active.")
        case .all: ("No reports", "")
        }
        let elsewhere = Segment.allCases.filter { $0 != .all && $0 != segment }.map { ($0, count($0)) }.first { $0.1 > 0 }
        let message = elsewhere.map { "\(copy.message)\n\nYou have \($0.1) \($0.0.rawValue.lowercased()) report\($0.1 == 1 ? "" : "s")." } ?? copy.message
        return SREmptyState(systemImage: segment == .closed ? "checkmark.circle" : "tray", title: copy.title, message: message) {
            if let (target, _) = elsewhere {
                Button("View \(target.rawValue)") { segment = target }.buttonStyle(.srSecondary)
            } else {
                reportButton
            }
        }
        .padding(.top, SR.Space.xxxl)
    }

    private var reportButton: some View {
        Button { appState.selectedTab = .map; appState.wantsReportFlow = true } label: {
            Label("Report a hazard", systemImage: "plus")
        }
        .buttonStyle(.srPrimary)
    }

    private func queuedCard(_ item: OfflineReportQueue.QueuedReport) -> some View {
        SRCard {
            HStack(alignment: .top, spacing: SR.Space.sm) {
                Image(systemName: "tray.and.arrow.up.fill")
                    .foregroundStyle(SR.Palette.warning)
                    .frame(width: 40, height: 40)
                    .background(SR.Palette.warning.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: SR.Space.xxs) {
                    Text(item.request.type.displayName).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                    Text(item.lastError ?? "Waiting for a connection · saved \(Format.relativeInSentence(item.queuedAt))")
                        .font(SR.Font.secondary)
                        .foregroundStyle(item.lastError == nil ? SR.Palette.textSecondary : SR.Palette.critical)
                }
                Spacer(minLength: 0)
                Button(role: .destructive) { queue.remove(item.id) } label: {
                    Image(systemName: "trash").frame(width: SR.Layout.minTouchTarget, height: SR.Layout.minTouchTarget)
                }
                .foregroundStyle(SR.Palette.textSecondary)
                .accessibilityLabel("Discard queued report")
            }
        }
    }

    // MARK: Filtering

    private func reports(in segment: Segment) -> [MyReport] {
        store.reports.filter { report in
            switch segment {
            case .all: return true
            case .processing: return !report.submission.status.isTerminal || report.submission.status == .failed
            case .active: return report.hazard?.status.isActive == true
            case .closed: return report.hazard.map { !$0.status.isActive } ?? false
            }
        }
    }

    private func count(_ segment: Segment) -> Int {
        if segment == .active { return activeItems.count }
        return reports(in: segment).count + (segment == .processing ? queue.items.count : 0)
    }

    // MARK: Active tab — scope + filters

    /// Re-run the nearby query when anything it depends on changes (location rounded to ~100 m).
    private var nearbyQueryKey: String {
        let here = location.currentLocation.map { String(format: "%.3f,%.3f", $0.latitude, $0.longitude) } ?? "none"
        return "\(segment.rawValue)|\(activeFilter.scope.rawValue)|\(activeFilter.effectiveRange.rawValue)|\(activeFilter.types.map(\.rawValue).sorted().joined(separator: ","))|\(here)"
    }

    private struct ActiveItem: Identifiable {
        let hazard: Hazard
        let distance: Double?
        let report: MyReport?
        var id: UUID { hazard.id }
    }

    private var activeItems: [ActiveItem] {
        switch activeFilter.scope {
        case .mine:
            var seen = Set<UUID>()
            let mine = reports(in: .active).compactMap { report -> (hazard: Hazard, createdAt: Date)? in
                guard let hazard = report.hazard, seen.insert(hazard.id).inserted else { return nil }
                return (hazard, report.submission.createdAt)
            }
            let byHazard = Dictionary(store.reports.compactMap { r in r.hazard.map { ($0.id, r) } }, uniquingKeysWith: { a, _ in a })
            return activeFilter.apply(to: mine, from: location.currentLocation)
                .map { ActiveItem(hazard: $0.hazard, distance: $0.distance, report: byHazard[$0.hazard.id]) }
        case .nearby:
            guard location.currentLocation != nil else { return [] }
            return activeFilter.apply(to: nearby.hazards.filter { $0.status.isActive }.map { ($0, $0.createdAt) },
                                      from: location.currentLocation)
                .map { ActiveItem(hazard: $0.hazard, distance: $0.distance, report: nil) }
        }
    }

    private var activeControls: some View {
        VStack(alignment: .leading, spacing: SR.Space.sm) {
            Picker("Show", selection: $activeFilter.scope) {
                ForEach(ActiveHazardsFilter.Scope.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)

            Button { isShowingActiveFilters = true } label: {
                HStack(spacing: SR.Space.xs) {
                    Image(systemName: "slider.horizontal.3").foregroundStyle(SR.Palette.navy)
                    Text(activeFilter.summary)
                        .font(SR.Font.secondary)
                        .foregroundStyle(SR.Palette.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: SR.Space.xs)
                    if activeFilter.activeRefinementCount > 0 {
                        Text("\(activeFilter.activeRefinementCount)")
                            .font(SR.Font.metaStrong)
                            .foregroundStyle(SR.Palette.onNavy)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(SR.Palette.navy, in: Circle())
                    }
                    Text("Filters").font(SR.Font.secondary.weight(.semibold)).foregroundStyle(SR.Palette.navy)
                }
                .padding(.horizontal, SR.Space.md)
                .frame(minHeight: SR.Layout.minTouchTarget + 4)
                .srCardSurface(radius: SR.Radius.button)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Filters: \(activeFilter.summary)")
            .accessibilityHint("Change distance, hazard types, severity and sort order")

            if needsLocationHint {
                Label(location.state == .denied
                      ? "Distance filters need location access."
                      : "Waiting for your location — distance filters apply once it's found.",
                      systemImage: "location.slash")
                    .font(SR.Font.meta)
                    .foregroundStyle(SR.Palette.warning)
            }
        }
    }

    private var needsLocationHint: Bool {
        location.currentLocation == nil
            && (activeFilter.scope == .nearby || activeFilter.range != .any || activeFilter.sort == .nearest)
    }

    @ViewBuilder
    private var activeContent: some View {
        let items = activeItems
        if activeFilter.scope == .nearby && location.currentLocation == nil {
            SREmptyState(systemImage: "location.magnifyingglass",
                         title: location.state == .denied ? "Location access is off" : "Finding your location…",
                         message: location.state == .denied
                            ? "Allow SafeRoute to use your location to see active hazards around you."
                            : LocationManager.isSimulator
                                ? "The Simulator has no location yet. Choose Features ▸ Location ▸ Custom Location."
                                : "Nearby hazards appear as soon as your position is found.")
                .padding(.top, SR.Space.xxl)
        } else if activeFilter.scope == .nearby && nearby.loadState.isLoading && nearby.hazards.isEmpty {
            SRCard { HStack { ProgressView(); Text("Loading hazards near you…").foregroundStyle(SR.Palette.textSecondary) } }
        } else if activeFilter.scope == .nearby, let error = nearby.loadState.errorMessage, nearby.hazards.isEmpty {
            SREmptyState(systemImage: "wifi.exclamationmark", title: "Couldn't load nearby hazards", message: error) {
                Button("Try again") {
                    if let here = location.currentLocation { Task { await nearby.load(around: here, filter: activeFilter, force: true) } }
                }
                .buttonStyle(.srSecondary)
            }
        } else if items.isEmpty {
            SREmptyState(systemImage: activeFilter.scope == .nearby ? "checkmark.shield" : "line.3.horizontal.decrease.circle",
                         title: activeFilter.scope == .nearby ? "No active hazards match" : "No active reports match",
                         message: activeFilter.scope == .nearby
                            ? "Nothing reported within \(activeFilter.effectiveRange.label) matches your filters."
                            : "Your reported hazards appear here while they're still affecting commuters.") {
                if activeFilter.activeRefinementCount > 0 {
                    Button("Reset filters") { activeFilter = ActiveHazardsFilter(scope: activeFilter.scope) }.buttonStyle(.srSecondary)
                } else if activeFilter.scope == .mine {
                    Button("See all nearby hazards") { activeFilter.scope = .nearby }.buttonStyle(.srSecondary)
                }
            }
            .padding(.top, SR.Space.xxl)
        } else {
            LazyVStack(alignment: .leading, spacing: SR.Space.betweenCards) {
                Text("\(items.count) active hazard\(items.count == 1 ? "" : "s")")
                    .font(SR.Font.metaStrong)
                    .foregroundStyle(SR.Palette.textSecondary)
                ForEach(items) { item in
                    Button { selected = SelectedHazard(id: item.hazard.id) } label: {
                        if let report = item.report, activeFilter.scope == .mine {
                            ReportCard(report: report, place: places.name(for: item.hazard.coordinate), distance: item.distance)
                        } else {
                            NearbyHazardCard(hazard: item.hazard, distance: item.distance,
                                             place: places.name(for: item.hazard.coordinate),
                                             isMine: item.hazard.reporterId == appState.currentUser?.id)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// Hierarchy: type + status → street → time → community.
private struct ReportCard: View {
    let report: MyReport
    let place: String?
    var distance: Double?

    var body: some View {
        let type = report.hazard?.type ?? report.submission.submittedType
        let state = report.displayState
        SRCard(padding: SR.Space.md) {
            HStack(alignment: .top, spacing: SR.Space.sm) {
                HazardIcon(type: type, severity: report.hazard?.severity ?? .unknown, size: 40)
                VStack(alignment: .leading, spacing: SR.Space.xxs) {
                    SRTitleBadgeRow {
                        Text(type.displayName).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                            .minimumScaleFactor(0.7) // single long words ("Accessibility") at huge text sizes
                    } badge: {
                        Label(state.label, systemImage: state.symbol)
                            .font(SR.Font.metaStrong)
                            .lineLimit(1)
                            .fixedSize()
                            .foregroundStyle(state.color)
                            .padding(.horizontal, SR.Space.xs)
                            .padding(.vertical, SR.Space.xxs)
                            .background(state.color.opacity(0.10), in: Capsule())
                    }
                    if let placeLine {
                        Text(placeLine).font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
                    }
                    Text(detailLine)
                        .font(SR.Font.meta)
                        .foregroundStyle(report.submission.status == .failed ? SR.Palette.critical : SR.Palette.textSecondary)
                    if report.mergedIntoExisting {
                        Text("Someone had already reported this — your report counted as a confirmation.")
                            .font(SR.Font.meta)
                            .foregroundStyle(SR.Palette.textTertiary)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(report.hazard != nil ? "Opens details and history" : "")
    }

    private var placeLine: String? {
        let parts = [place.flatMap { $0.isEmpty ? nil : $0 }, distance.map { "\(Format.distance($0)) away" }].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var detailLine: String {
        let when = "Reported \(Format.relativeInSentence(report.submission.createdAt))"
        if let hazard = report.hazard {
            var parts = ["\(hazard.confirmationCount) confirmation\(hazard.confirmationCount == 1 ? "" : "s")"]
            if hazard.disputeCount > 0 { parts.append("\(hazard.disputeCount) dispute\(hazard.disputeCount == 1 ? "" : "s")") }
            if let confidence = hazard.confidence, [.high, .medium].contains(confidence) { parts.append(confidence.label) }
            parts.append(when)
            return parts.joined(separator: " · ")
        }
        if report.submission.status == .queued { return "Checking whether someone already reported this… · \(when)" }
        return report.submission.failureReason ?? when
    }
}

/// An active hazard from any commuter (Active ▸ All nearby).
private struct NearbyHazardCard: View {
    let hazard: Hazard
    let distance: Double?
    let place: String?
    let isMine: Bool

    var body: some View {
        SRCard(padding: SR.Space.md) {
            HStack(alignment: .top, spacing: SR.Space.sm) {
                HazardIcon(type: hazard.type, severity: hazard.severity, size: 40)
                VStack(alignment: .leading, spacing: SR.Space.xxs) {
                    SRTitleBadgeRow {
                        Text(hazard.type.displayName).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                            .minimumScaleFactor(0.7)
                    } badge: {
                        SRStatusBadge(status: hazard.status)
                    }
                    if let distance {
                        HStack(alignment: .firstTextBaseline, spacing: SR.Space.xxs) {
                            Text(Format.distance(distance)).font(SR.Font.cardTitle.monospacedDigit()).foregroundStyle(SR.Palette.textPrimary)
                            Text(place.flatMap { $0.isEmpty ? nil : "away · \($0)" } ?? "away")
                                .font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
                        }
                    }
                    Text([
                        "\(hazard.confirmationCount) confirmation\(hazard.confirmationCount == 1 ? "" : "s")",
                        hazard.severity.label,
                        "Reported \(Format.relativeInSentence(hazard.createdAt))"
                    ].joined(separator: " · "))
                        .font(SR.Font.meta)
                        .foregroundStyle(SR.Palette.textSecondary)
                    if isMine {
                        Label("Reported by you", systemImage: "person.fill")
                            .font(SR.Font.metaStrong)
                            .foregroundStyle(SR.Palette.navy)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens hazard details")
    }
}

/// Distance / types / severity / sort for the Active tab.
private struct ActiveFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var filter: ActiveHazardsFilter

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: SR.Space.xl) {
                    section("Show") {
                        Picker("Show", selection: $filter.scope) {
                            ForEach(ActiveHazardsFilter.Scope.allCases) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        Text(filter.scope == .mine
                             ? "Hazards you reported that are still active."
                             : "Active hazards from every commuter within the distance you choose.")
                            .font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                    }
                    section("Distance from you") {
                        FlowLayout {
                            ForEach(ActiveHazardsFilter.Range.allCases.filter { filter.scope == .mine || $0 != .any }) { range in
                                SRFilterChip(title: range.label, isSelected: filter.effectiveRange == range) { filter.range = range }
                            }
                        }
                    }
                    section("Hazard types") {
                        FlowLayout {
                            ForEach(HazardType.reportable) { type in
                                SRFilterChip(title: type.displayName, systemImage: type.symbolName,
                                             isSelected: filter.types.contains(type)) {
                                    if filter.types.contains(type) {
                                        if filter.types.count > 1 { filter.types.remove(type) } // keep at least one
                                    } else {
                                        filter.types.insert(type)
                                    }
                                }
                            }
                        }
                    }
                    section("Severity") {
                        FlowLayout {
                            ForEach(Severity.allLevels, id: \.self) { severity in
                                SRFilterChip(title: severity.shortLabel, systemImage: severity.symbolName,
                                             isSelected: filter.severities.contains(severity)) {
                                    if filter.severities.contains(severity) {
                                        if filter.severities.count > 1 { filter.severities.remove(severity) }
                                    } else {
                                        filter.severities.insert(severity)
                                    }
                                }
                            }
                        }
                    }
                    section("Sort by") {
                        FlowLayout {
                            ForEach(ActiveHazardsFilter.Sort.allCases) { sort in
                                SRFilterChip(title: sort.label, isSelected: filter.sort == sort) { filter.sort = sort }
                            }
                        }
                    }
                }
                .padding(SR.Space.screenMargin)
            }
            .navigationTitle("Active hazards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") { filter = ActiveHazardsFilter(scope: filter.scope) }
                        .disabled(filter.activeRefinementCount == 0)
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.fontWeight(.semibold) }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(.ultraThinMaterial)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: SR.Space.sm) {
            Text(title).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
            content()
        }
    }
}
