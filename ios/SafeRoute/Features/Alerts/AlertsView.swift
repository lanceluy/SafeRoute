import SwiftUI

struct AlertsView: View {
    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", unread = "Unread", nearby = "Nearby", route = "Route"
        var id: String { rawValue }
    }

    @EnvironmentObject private var appState: AppState
    @ObservedObject var store: AlertsStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var filter: Filter = .all
    @State private var selected: SelectedHazard?

    var body: some View {
        NavigationStack {
            SRScrollPage {
                VStack(alignment: .leading, spacing: SR.Space.md) {
                    SRPageHeader("Alerts", subtitle: "Updates that matter to your route") {
                        if store.unreadCount > 0 {
                            Button("Mark all read") { store.markAllRead() }
                                .font(SR.Font.secondary.weight(.medium))
                                .foregroundStyle(SR.Palette.navy)
                                .frame(minHeight: SR.Layout.minTouchTarget)
                        }
                    }
                    if !store.items.isEmpty { chips }
                }
                content
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(item: $selected) { selection in
                HazardDetailView(hazardId: selection.id, map: appState.map, onFindSaferRoute: {
                    selected = nil
                    appState.selectedTab = .map
                    appState.wantsRoutePlanner = true
                })
            }
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: SR.Space.xs) {
                ForEach(Filter.allCases) { f in
                    SRFilterChip(title: f.rawValue, count: f == .all ? nil : items(for: f).count, isSelected: filter == f) {
                        withAnimation(SR.Motion.standard(reduceMotion: reduceMotion)) { filter = f }
                    }
                }
            }
        }
        .scrollClipDisabled()
    }

    @ViewBuilder
    private var content: some View {
        let visible = items(for: filter)
        if store.items.isEmpty {
            allClear
        } else if visible.isEmpty {
            SREmptyState(systemImage: filter == .unread ? "checkmark.circle" : "bell.slash",
                         title: filter == .unread ? "You're all caught up" : "No \(filter.rawValue.lowercased()) alerts",
                         message: filter == .route
                            ? "Alerts about hazards ahead on a planned route appear here."
                            : "Nothing here right now.") {
                Button("Show all alerts") { filter = .all }.buttonStyle(.srSecondary)
            }
            .padding(.top, SR.Space.xxxl)
        } else {
            LazyVStack(spacing: SR.Space.betweenCards) {
                ForEach(visible) { item in
                    Button {
                        store.markRead(item.id)
                        selected = SelectedHazard(id: item.frame.hazardId)
                    } label: {
                        AlertCard(item: item)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Review §16: a useful state, not a dead end.
    private var allClear: some View {
        SREmptyState(systemImage: "checkmark.shield", title: "You're all clear",
                     message: "No active hazards are affecting your route right now. We'll let you know if that changes.") {
            NavigationLink {
                NotificationPreferencesView()
            } label: {
                Label("Alert preferences", systemImage: "arrow.right")
                    .labelStyle(TrailingIconLabelStyle())
                    .font(SR.Font.secondary.weight(.semibold))
                    .foregroundStyle(SR.Palette.navy)
                    .frame(minHeight: SR.Layout.minTouchTarget)
            }
        }
        .padding(.top, SR.Space.xxxl)
    }

    private func items(for filter: Filter) -> [AlertsStore.AlertItem] {
        switch filter {
        case .all: return store.items
        case .unread: return store.items.filter { !$0.read }
        case .nearby: return store.items.filter { !$0.frame.onRoute }
        case .route: return store.items.filter { $0.frame.onRoute }
        }
    }
}

/// One primary data point per card: how far the hazard is (review §17, §35).
private struct AlertCard: View {
    let item: AlertsStore.AlertItem

    var body: some View {
        let frame = item.frame
        SRCard(padding: SR.Space.md) {
            HStack(alignment: .top, spacing: SR.Space.sm) {
                HazardIcon(type: frame.hazardType, severity: frame.severity, size: 40)
                VStack(alignment: .leading, spacing: SR.Space.xxs) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(frame.alertTitle)
                            .font(item.read ? SR.Font.body : SR.Font.cardTitle)
                            .foregroundStyle(SR.Palette.textPrimary)
                        Spacer(minLength: SR.Space.xs)
                        if !item.read {
                            Circle().fill(SR.Palette.navy).frame(width: 8, height: 8).accessibilityLabel("Unread")
                        }
                    }
                    HStack(alignment: .firstTextBaseline, spacing: SR.Space.xxs) {
                        Text(Format.distance(frame.onRoute ? frame.distanceAheadMeters ?? frame.distanceMeters : frame.distanceMeters))
                            .font(SR.Font.metric)
                            .foregroundStyle(SR.Palette.textPrimary)
                        Text(frame.onRoute ? "ahead on your route" : "away")
                            .font(SR.Font.secondary)
                            .foregroundStyle(SR.Palette.textSecondary)
                    }
                    Text(Format.relative(item.receivedAt)).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                    Divider().padding(.vertical, SR.Space.xxs)
                    HStack {
                        Text(communityLine(frame)).font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                        Spacer()
                        Image(systemName: "chevron.right").font(SR.Font.meta.weight(.semibold)).foregroundStyle(SR.Palette.textTertiary)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens hazard details")
    }

    private func communityLine(_ frame: HazardEventFrame) -> String {
        switch frame.status {
        case .verified: return "Verified by \(frame.confirmationCount) commuter\(frame.confirmationCount == 1 ? "" : "s") · \(frame.severity.label)"
        case .disputed: return "Community disagreement · \(frame.severity.label)"
        default: return "\(frame.status.label) · \(frame.severity.label)"
        }
    }
}

struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: SR.Space.xxs) {
            configuration.title
            configuration.icon
        }
    }
}
