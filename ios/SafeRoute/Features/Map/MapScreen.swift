import SwiftUI
import MapKit

/// Home screen: an edge-to-edge map with a few glass controls floating over it.
///
///   Top     search + filter button (plus status banners only when something is wrong)
///   Middle  mostly unobstructed map, small recenter control
///   Bottom  exactly one panel: nearby summary + Report  →  selected hazard preview
///           →  route comparison  →  navigation. Panels replace each other; they never stack.
struct MapScreen: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject var model: MapViewModel
    @ObservedObject private var socket = WebSocketClient.shared
    @ObservedObject private var connectivity = ConnectivityMonitor.shared
    @ObservedObject private var location = LocationManager.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var isShowingReport = false
    @State private var isShowingFilters = false
    @State private var isShowingPlanner = false
    @State private var isShowingNearby = false
    /// Opens part-way so the map (pins, direction) stays visible; drag up for the full list.
    @State private var nearbyDetent: PresentationDetent = Self.nearbyHalf
    @State private var detailHazard: SelectedHazard?
    @State private var isFollowingUser = true

    var body: some View {
        HazardMapView(
            hazards: model.isNavigating ? model.navigationHazards : model.visibleHazards,
            pending: Array(appState.reports.pending.values),
            plan: model.plan,
            useSaferRoute: model.useSaferRoute,
            command: model.command,
            selectedHazardId: model.selectedHazardId,
            isNavigating: model.isNavigating,
            followCoordinate: model.isNavigating ? location.currentLocation : nil,
            followHeading: location.course,
            labelledHazardIds: Set(model.navigation?.routeHazards.map(\.id) ?? []),
            onFollowChange: { isFollowingUser = $0 },
            onSelectHazard: { id in
                if model.isNavigating { detailHazard = SelectedHazard(id: id) }
                else { withAnimation(motion) { model.selectedHazardId = id } }
            },
            onTapBackground: { withAnimation(motion) { model.selectedHazardId = nil } },
            onRegionChange: { model.regionChanged($0) })
        .ignoresSafeArea()
        .accessibilityLabel("Hazard map")
        .safeAreaInset(edge: .top, spacing: 0) {
            if let session = model.navigation {
                // Navigation owns the top: directions and the next relevant warning.
                NavigationTopPanel(session: session, model: model,
                                   onSelectHazard: { detailHazard = SelectedHazard(id: $0) })
            } else {
                topBar
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let session = model.navigation {
                NavigationBottomPanel(session: session, isFollowing: isFollowingUser,
                                      onRecenter: { model.command = .init(command: .followUser) },
                                      onEnd: { model.endNavigation() },
                                      onFinish: { model.clearRoute() })
            } else {
                bottomArea
            }
        }
        .onChange(of: model.hazards) { _, _ in model.syncNavigationHazards() }
        .sheet(isPresented: $isShowingReport) { ReportFlowView() }
        .sheet(isPresented: $isShowingFilters) { FilterSheet(filters: $model.filters) }
        .sheet(isPresented: $isShowingPlanner) { RoutePlannerView() }
        .sheet(isPresented: $isShowingNearby) {
            NearbyHazardsSheet(
                items: nearby.items.map { NearbyHazardList.Item(hazard: $0.hazard, distance: $0.distance) },
                hasLocation: location.currentLocation != nil,
                radiusMeters: Self.nearbyRadiusMeters,
                selectedId: model.selectedHazardId,
                onSelect: { id in
                    // Row → pin: select and pan to it, and lower the sheet so the pin is visible.
                    withAnimation(motion) {
                        model.selectedHazardId = id
                        if let hazard = model.hazards[id] { model.command = .init(command: .focus(hazard.coordinate)) }
                        nearbyDetent = Self.nearbyPeek
                    }
                },
                onOpenDetails: { id in
                    isShowingNearby = false
                    detailHazard = SelectedHazard(id: id)
                })
            .presentationDetents([Self.nearbyPeek, Self.nearbyHalf, .large], selection: $nearbyDetent)
            .presentationDragIndicator(.visible)
            // The map stays usable above the sheet: tapping a pin scrolls the list to it.
            .presentationBackgroundInteraction(.enabled(upThrough: Self.nearbyHalf))
            .onAppear { nearbyDetent = Self.nearbyHalf }
        }
        .sheet(item: $detailHazard) { selection in
            HazardDetailView(hazardId: selection.id, map: model, onFindSaferRoute: {
                detailHazard = nil
                isShowingPlanner = true
            })
        }
        .onChange(of: appState.wantsReportFlow) { _, wants in
            if wants { isShowingReport = true; appState.wantsReportFlow = false }
        }
        .onChange(of: appState.wantsRoutePlanner) { _, wants in
            if wants { isShowingPlanner = true; appState.wantsRoutePlanner = false }
        }
        .onChange(of: appState.hazardToShow) { _, id in
            if let id { detailHazard = SelectedHazard(id: id); appState.hazardToShow = nil }
        }
        .onAppear {
            location.onSignificantChange = { coordinate in WebSocketClient.shared.updateLocation(coordinate) }
            location.requestPermission()
            if let here = location.currentLocation { WebSocketClient.shared.updateLocation(here) }
        }
        #if DEBUG
        .task { await runDemoIntent() }
        #endif
        .animation(motion, value: model.latestAlert)
        .animation(motion, value: model.selectedHazardId)
        .animation(motion, value: model.plan?.id)
    }

    /// "Nearby" in the summary means within this distance of the user (MapViewModel.nearbyActive).
    static let nearbyRadiusMeters: Double = 1000
    static let nearbyPeek = PresentationDetent.fraction(0.3)
    static let nearbyHalf = PresentationDetent.fraction(0.6)

    private var motion: Animation? { SR.Motion.standard(reduceMotion: reduceMotion) }

    // MARK: Top — search + filters

    private var topBar: some View {
        VStack(spacing: SR.Space.xs) {
            HStack(spacing: SR.Space.xs) {
                SRSearchField(placeholder: "Where are you going?", value: model.plan.map { "To \($0.destinationName)" }) {
                    isShowingPlanner = true
                }
                .accessibilityLabel(model.plan == nil ? "Where are you going? Plan a safe walking route" : "Change destination")

                Button { isShowingFilters = true } label: {
                    Image(systemName: "line.3.horizontal.decrease")
                        .font(SR.Font.body.weight(.semibold))
                        .foregroundStyle(model.filters.isDefault ? SR.Palette.textPrimary : SR.Palette.onNavy)
                        .frame(width: SR.Layout.minTouchTarget + 4, height: SR.Layout.minTouchTarget + 4)
                        .background(model.filters.isDefault ? SR.Palette.surface.opacity(0.85) : SR.Palette.navy,
                                    in: RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous)
                            .strokeBorder(SR.Palette.border, lineWidth: model.filters.isDefault ? 1 : 0))
                }
                .accessibilityLabel(model.filters.isDefault ? "Filters" : "Filters, active")
            }
            .padding(SR.Space.xs)
            .srGlassSurface(radius: SR.Radius.button + SR.Space.xs)

            statusBanners

            if let alert = model.latestAlert {
                AlertBanner(frame: alert,
                            onView: { model.selectedHazardId = alert.hazardId; model.dismissAlert() },
                            onReroute: { isShowingPlanner = true; model.dismissAlert() },
                            onDismiss: { model.dismissAlert() })
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(.horizontal, SR.Space.screenMargin)
        .padding(.top, SR.Space.xxs)
    }

    /// Only shown when something needs attention; a healthy map has no banners.
    @ViewBuilder
    private var statusBanners: some View {
        if !connectivity.isOnline {
            StateBanner(text: "No internet — showing saved map data", systemImage: "wifi.slash", tint: SR.Palette.critical)
        } else if socket.state == .reconnecting {
            StateBanner(text: "Reconnecting to live alerts…", systemImage: "antenna.radiowaves.left.and.right.slash", tint: SR.Palette.warning)
        }
        if !appState.offlineQueue.items.isEmpty {
            let n = appState.offlineQueue.items.count
            StateBanner(text: "\(n) report\(n == 1 ? "" : "s") waiting to send", systemImage: "tray.and.arrow.up.fill", tint: SR.Palette.warning)
        }
        if model.isZoomedOutTooFar {
            StateBanner(text: "Zoom in to see hazards", systemImage: "plus.magnifyingglass")
        } else if let error = model.loadState.errorMessage {
            StateBanner(text: error, systemImage: "exclamationmark.triangle.fill", tint: SR.Palette.critical,
                        actionTitle: "Try again") { Task { await model.refresh() } }
        }
        switch location.state {
        case .denied:
            StateBanner(text: "SafeRoute can't use your location — alerts and routes need it", systemImage: "location.slash.fill",
                        tint: SR.Palette.warning, actionTitle: "Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            }
        case .unavailable where LocationManager.isSimulator:
            StateBanner(text: "The Simulator has no location set. Choose Features ▸ Location ▸ Custom Location (e.g. 14.5547, 121.0244).",
                        systemImage: "location.slash", tint: SR.Palette.warning)
        case .unavailable:
            StateBanner(text: "Can't find your location right now", systemImage: "location.slash", tint: SR.Palette.warning,
                        actionTitle: "Retry") { location.refresh() }
        default:
            EmptyView()
        }
    }

    // MARK: Bottom — one panel at a time

    private var bottomArea: some View {
        VStack(alignment: .trailing, spacing: SR.Space.sm) {
            recenterButton
            Group {
                if let hazard = model.selectedHazard {
                    SRHazardPreviewCard(
                        hazard: hazard,
                        distance: Format.distance(from: location.currentLocation, to: hazard.coordinate),
                        onDetails: { detailHazard = SelectedHazard(id: hazard.id) },
                        onSafeRoute: { isShowingPlanner = true },
                        onClose: { model.selectedHazardId = nil })
                } else if let plan = model.plan {
                    RouteComparisonCard(plan: plan, useSafer: $model.useSaferRoute,
                                        onClose: { model.clearRoute() },
                                        onSelectHazard: { model.selectedHazardId = $0 },
                                        onStart: startNavigation)
                } else {
                    summaryPanel
                }
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
        .padding(.horizontal, SR.Space.screenMargin)
        .padding(.bottom, SR.Space.xs)
    }

    private var summaryPanel: some View {
        HStack(spacing: SR.Space.sm) {
            Button { isShowingNearby = true } label: {
                HStack(spacing: SR.Space.xs) {
                    VStack(alignment: .leading, spacing: 2) {
                        // Full wording when it fits, a shorter form on narrow screens or large text.
                        ViewThatFits(in: .horizontal) {
                            Text(nearby.headline).lineLimit(1)
                            Text(nearby.shortHeadline).lineLimit(1)
                        }
                        .font(SR.Font.cardTitle)
                        .foregroundStyle(SR.Palette.textPrimary)
                        Text(nearby.scope)
                            .font(SR.Font.secondary)
                            .foregroundStyle(SR.Palette.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.up")
                        .font(SR.Font.meta.weight(.semibold))
                        .foregroundStyle(SR.Palette.textSecondary)
                }
                .frame(minHeight: SR.Layout.minTouchTarget + 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(nearby.headline), \(nearby.scope)")
            .accessibilityHint("Shows the list of nearby hazards")

            Button { isShowingReport = true } label: {
                Label("Report", systemImage: "plus")
                    .font(SR.Font.body.weight(.semibold))
                    .foregroundStyle(SR.Palette.onNavy)
                    .padding(.horizontal, SR.Space.md)
                    .frame(minHeight: SR.Layout.minTouchTarget + 4)
                    .background(SR.Palette.navy, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Report a hazard")
            .accessibilityHint("Starts a guided hazard report")
        }
        .padding(.leading, SR.Space.md)
        .padding(.trailing, SR.Space.sm)
        .padding(.vertical, SR.Space.sm)
        .srGlassSurface(radius: SR.Radius.card)
    }

    private var recenterButton: some View {
        Button {
            if location.currentLocation != nil {
                model.command = .init(command: .recenterOnUser)
            } else if location.state == .denied {
                appState.show(Toast(message: "Allow location access in Settings to center the map on you.",
                                    systemImage: "location.slash.fill", style: .warning))
            } else {
                location.refresh()
            }
        } label: {
            // Filled while the map follows you (Apple Maps convention); outline once you've panned away.
            Image(systemName: isFollowingUser ? "location.fill" : "location")
                .font(SR.Font.body)
                .foregroundStyle(SR.Palette.navy)
                .frame(width: SR.Layout.minTouchTarget, height: SR.Layout.minTouchTarget)
                .srGlassSurface(radius: SR.Layout.minTouchTarget / 2)
        }
        .accessibilityLabel(isFollowingUser ? "Following your location" : "Follow my location")
        .accessibilityHint(isFollowingUser ? "The map moves with you. Drag the map to stop following." : "Centers the map on you and keeps it there as you move.")
    }

    // MARK: Nearby scope

    /// "Nearby" = active hazards within 1 km of the user; without a location, the visible map.
    private var nearby: (items: [(hazard: Hazard, distance: Double?)], headline: String, shortHeadline: String, scope: String) {
        let items: [(hazard: Hazard, distance: Double?)]
        let scope: String
        if location.currentLocation != nil {
            items = model.nearbyActive.map { ($0.hazard, Optional($0.distance)) }
            scope = "Within \(NearbyHazardList.radius(Self.nearbyRadiusMeters)) of you"
        } else {
            items = model.visibleHazards.filter { $0.status.isActive }.map { ($0, nil) }
            scope = "In the visible map area"
        }
        guard !items.isEmpty else {
            let text = model.loadState.isLoading ? "Loading hazards…" : "No active reports"
            return (items, text, text, scope)
        }
        let high = items.filter { $0.hazard.severity == .high }.count
        return (items, "\(items.count) nearby" + (high > 0 ? " · \(high) high severity" : ""),
                "\(items.count) hazard\(items.count == 1 ? "" : "s") near you", scope)
    }

    private func startNavigation() {
        guard location.currentLocation != nil else {
            appState.show(Toast(message: LocationManager.isSimulator
                                ? "Navigation needs your location. In the Simulator: Features ▸ Location ▸ Custom Location."
                                : "Navigation needs your location. Waiting for a position…",
                                systemImage: "location.slash", style: .warning))
            location.refresh()
            return
        }
        withAnimation(motion) { model.startNavigation() }
    }

    #if DEBUG
    /// SAFEROUTE_DEMO_OPEN=preview|detail|report|planner|filters|nearby|navigate — screenshot automation only.
    private func runDemoIntent() async {
        guard let intent = ProcessInfo.processInfo.environment["SAFEROUTE_DEMO_OPEN"] else { return }
        switch intent {
        case "report": isShowingReport = true
        case "planner": isShowingPlanner = true
        case "filters": isShowingFilters = true
        case "nearby":
            for _ in 0..<40 where model.nearbyActive.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
            isShowingNearby = true
        case "navigate":
            // SAFEROUTE_DEMO_ROUTE_TO="lat,lon,Name": plan a route and start navigation. With
            // ios/scripts/simulate-walks.sh running, the Simulator then walks it (SimulatedWalk).
            let parts = (ProcessInfo.processInfo.environment["SAFEROUTE_DEMO_ROUTE_TO"] ?? "").split(separator: ",")
            guard parts.count >= 2, let lat = Double(parts[0]), let lon = Double(parts[1]) else { return }
            for _ in 0..<40 where location.currentLocation == nil { try? await Task.sleep(for: .milliseconds(250)) }
            guard let here = location.currentLocation,
                  let plan = try? await RouteAvoidanceService.shared.plan(
                    from: here, to: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                    destinationName: parts.count > 2 ? String(parts[2]) : "Destination") else { return }
            model.setPlan(plan)
            try? await Task.sleep(for: .seconds(1))
            startNavigation()
        case "preview", "detail":
            for _ in 0..<40 where model.nearbyActive.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
            guard let first = model.nearbyActive.first?.hazard.id else { return }
            if intent == "preview" { model.selectedHazardId = first } else { detailHazard = SelectedHazard(id: first) }
        default: break
        }
    }
    #endif
}

struct SelectedHazard: Identifiable {
    let id: UUID
}

/// Floating preview shown when a pin is tapped, before the full detail sheet.
struct SRHazardPreviewCard: View {
    let hazard: Hazard
    let distance: Double?
    let onDetails: () -> Void
    let onSafeRoute: () -> Void
    let onClose: () -> Void

    var body: some View {
        SRGlassCard(padding: SR.Space.lg) {
            HStack(alignment: .top, spacing: SR.Space.sm) {
                HazardIcon(type: hazard.type, severity: hazard.severity, size: 40)
                VStack(alignment: .leading, spacing: SR.Space.xxs) {
                    Text(hazard.type.displayName).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                    Text([distance.map { "\(Format.distance($0)) away" }, Format.relative(hazard.createdAt)]
                            .compactMap { $0 }.joined(separator: " · "))
                        .font(SR.Font.secondary)
                        .foregroundStyle(SR.Palette.textSecondary)
                }
                Spacer(minLength: 0)
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(SR.Font.meta.weight(.bold))
                        .foregroundStyle(SR.Palette.textSecondary)
                        .frame(width: SR.Layout.minTouchTarget, height: SR.Layout.minTouchTarget)
                }
                .accessibilityLabel("Close preview")
                .padding(.top, -SR.Space.sm)
                .padding(.trailing, -SR.Space.sm)
            }
            HStack(spacing: SR.Space.xs) {
                SRSeverityBadge(severity: hazard.severity, compact: true)
                SRStatusBadge(status: hazard.status)
            }
            HStack(spacing: SR.Space.xs) {
                Image(systemName: "person.2.fill").font(SR.Font.meta).foregroundStyle(SR.Palette.textSecondary)
                    .accessibilityHidden(true)
                Text(hazard.status == .disputed ? "Reports disagree" : Format.confirmations(hazard.confirmationCount))
                    .font(SR.Font.meta)
                    .foregroundStyle(SR.Palette.textSecondary)
            }
            HStack(spacing: SR.Space.sm) {
                Button("View details", action: onDetails).buttonStyle(.srSecondary)
                Button(action: onSafeRoute) { Label("Safe route", systemImage: "arrow.triangle.turn.up.right.diamond") }
                    .buttonStyle(.srPrimary)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

struct AlertBanner: View {
    let frame: HazardEventFrame
    let onView: () -> Void
    let onReroute: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        SRGlassCard(padding: SR.Space.md) {
            HStack(alignment: .top, spacing: SR.Space.sm) {
                HazardIcon(type: frame.hazardType, severity: frame.severity, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(frame.alertTitle).font(SR.Font.cardTitle).foregroundStyle(SR.Palette.textPrimary)
                    Text(frame.alertSubtitle).font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
                }
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark").foregroundStyle(SR.Palette.textSecondary)
                        .frame(width: SR.Layout.minTouchTarget, height: SR.Layout.minTouchTarget)
                }
                .accessibilityLabel("Dismiss alert")
            }
            HStack(spacing: SR.Space.sm) {
                Button("View", action: onView).buttonStyle(.srSecondary)
                Button("Find safer route", action: onReroute).buttonStyle(.srPrimary)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: SR.Radius.floating, style: .continuous).strokeBorder(frame.severity.color, lineWidth: 2))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Alert: \(frame.alertTitle). \(frame.alertSubtitle)")
    }
}

/// Map filters as chips. Presented as a glass sheet.
struct FilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var filters: MapFilters

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: SR.Space.xl) {
                    section("Show hazards") {
                        FlowLayout {
                            ForEach(HazardType.reportable) { type in
                                SRFilterChip(title: type.displayName, systemImage: type.symbolName,
                                             isSelected: filters.types.contains(type)) { toggle(type) }
                            }
                        }
                    }
                    section("Status") {
                        FlowLayout {
                            ForEach(MapFilters.selectableStatuses, id: \.self) { status in
                                SRFilterChip(title: status.label, isSelected: filters.statuses.contains(status)) { toggle(status) }
                            }
                        }
                    }
                    section("Distance from me") {
                        FlowLayout {
                            ForEach(MapFilters.DistanceLimit.allCases) { limit in
                                SRFilterChip(title: limit == .any ? "Any" : limit.label, isSelected: filters.distance == limit) {
                                    filters.distance = limit
                                }
                            }
                        }
                    }
                }
                .padding(SR.Space.screenMargin)
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") { filters = .default }.disabled(filters.isDefault)
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

    private func toggle(_ type: HazardType) {
        if filters.types.contains(type) { filters.types.remove(type) } else { filters.types.insert(type) }
    }

    private func toggle(_ status: HazardStatus) {
        let on = !filters.statuses.contains(status)
        if on { filters.statuses.insert(status) } else { filters.statuses.remove(status) }
        // "No longer active" rides along with Resolved: both mean "no longer on the street".
        if status == .resolved {
            if on { filters.statuses.insert(.expired) } else { filters.statuses.remove(.expired) }
        }
    }
}
