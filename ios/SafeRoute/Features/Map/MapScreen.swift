import SwiftUI
import MapKit

/// Home screen: an edge-to-edge map with glass controls floating over it (UI review §4–6, §42).
struct MapScreen: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject var model: MapViewModel
    @ObservedObject private var socket = WebSocketClient.shared
    @ObservedObject private var connectivity = ConnectivityMonitor.shared
    @ObservedObject private var location = LocationManager.shared
    @ObservedObject private var places = PlaceNameCache.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var isShowingReport = false
    @State private var isShowingFilters = false
    @State private var isShowingPlanner = false
    @State private var isNearbyExpanded = false
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
                // While walking, skip the preview and go straight to details.
                if model.isNavigating { detailHazard = SelectedHazard(id: id) }
                else { withAnimation(motion) { model.selectedHazardId = id } }
            },
            onTapBackground: { withAnimation(motion) { model.selectedHazardId = nil; isNearbyExpanded = false } },
            onRegionChange: { model.regionChanged($0) })
        .ignoresSafeArea()
        .accessibilityLabel("Hazard map")
        .safeAreaInset(edge: .top, spacing: 0) {
            if let session = model.navigation {
                VStack(spacing: SR.Space.sm) {
                    NavigationTopPanel(session: session, model: model,
                                       onSelectHazard: { detailHazard = SelectedHazard(id: $0) })
                    if let alert = model.latestAlert {
                        AlertBanner(frame: alert,
                                    onView: { detailHazard = SelectedHazard(id: alert.hazardId); model.dismissAlert() },
                                    onReroute: { model.dismissAlert(); Task { await model.reroute() } },
                                    onDismiss: { model.dismissAlert() })
                            .padding(.horizontal, SR.Space.screenMargin)
                    }
                }
            } else {
                topControls
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let session = model.navigation {
                NavigationBottomPanel(session: session, isFollowing: isFollowingUser,
                                      onRecenter: { model.command = .init(command: .followUser) },
                                      onEnd: { model.endNavigation() },
                                      onFinish: { model.clearRoute() })
            } else {
                bottomControls
            }
        }
        .onChange(of: model.hazards) { _, _ in model.syncNavigationHazards() }
        .sheet(isPresented: $isShowingReport) { ReportFlowView() }
        .sheet(isPresented: $isShowingFilters) { FilterSheet(filters: $model.filters) }
        .sheet(isPresented: $isShowingPlanner) { RoutePlannerView() }
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
            location.onSignificantChange = { coordinate in
                WebSocketClient.shared.updateLocation(coordinate)
            }
            location.requestPermission()
            #if DEBUG
            // Screenshot automation can't answer the system prompt.
            if ProcessInfo.processInfo.environment["SAFEROUTE_DEMO_SKIP_PROMPTS"] == nil {
                NotificationManager.shared.requestPermission()
            }
            #else
            NotificationManager.shared.requestPermission()
            #endif
            if let here = location.currentLocation { WebSocketClient.shared.updateLocation(here) }
        }
        #if DEBUG
        .task { await runDemoIntent() }
        #endif
        .animation(motion, value: model.latestAlert)
        .animation(motion, value: model.loadState)
        .animation(motion, value: model.selectedHazardId)
    }

    private var motion: Animation? { SR.Motion.standard(reduceMotion: reduceMotion) }

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

    // MARK: Top — greeting, safety summary, search (review §6, §38)

    private var topControls: some View {
        VStack(spacing: SR.Space.sm) {
            SRGlassCard(padding: SR.Space.md) {
                HStack(alignment: .top, spacing: SR.Space.sm) {
                    VStack(alignment: .leading, spacing: SR.Space.xxs) {
                        Text(greeting)
                            .font(SR.Font.greeting)
                            .foregroundStyle(SR.Palette.textPrimary)
                        safetySummary
                    }
                    Spacer(minLength: 0)
                }
                HStack(spacing: SR.Space.xs) {
                    SRSearchField(placeholder: "Where are you going?", value: model.plan.map { "To \($0.destinationName)" }) {
                        isShowingPlanner = true
                    }
                    .accessibilityLabel(model.plan == nil ? "Where are you going? Plan a safe walking route" : "Change destination")

                    Button { isShowingFilters = true } label: {
                        Image(systemName: "line.3.horizontal.decrease")
                            .font(SR.Font.cardTitle)
                            .foregroundStyle(model.filters.isDefault ? SR.Palette.textPrimary : SR.Palette.onNavy)
                            .frame(width: SR.Layout.minTouchTarget + 4, height: SR.Layout.minTouchTarget + 4)
                            .background(model.filters.isDefault ? SR.Palette.surface.opacity(0.85) : SR.Palette.navy,
                                        in: RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: SR.Radius.button, style: .continuous)
                                .strokeBorder(SR.Palette.border, lineWidth: model.filters.isDefault ? 1 : 0))
                    }
                    .accessibilityLabel(model.filters.isDefault ? "Filters" : "Filters, active")
                }
            }

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

    private var greeting: String {
        let first = appState.currentUser?.displayName?.split(separator: " ").first.map(String.init)
        return first.map { "\(Format.greeting()), \($0) 👋" } ?? "\(Format.greeting()) 👋"
    }

    @ViewBuilder
    private var safetySummary: some View {
        let nearby = model.nearbyActive
        let high = nearby.filter { $0.hazard.severity == .high }.count
        let area = location.currentLocation.flatMap { places.neighbourhood(for: $0) }
        if location.currentLocation == nil {
            Text(locationSummary)
                .font(SR.Font.secondary).foregroundStyle(SR.Palette.textSecondary)
        } else if high > 0 {
            Label("Heads up · \(high) high-severity hazard\(high == 1 ? "" : "s") nearby", systemImage: "exclamationmark.triangle.fill")
                .font(SR.Font.secondary.weight(.medium))
                .foregroundStyle(SR.Palette.critical)
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Text(nearby.isEmpty ? "Your area looks clear" : "Your area looks mostly clear · \(nearby.count) hazard\(nearby.count == 1 ? "" : "s") within 1 km")
                    .font(SR.Font.secondary)
                    .foregroundStyle(SR.Palette.textSecondary)
                if let area {
                    Text("Stay aware around \(area)").font(SR.Font.meta).foregroundStyle(SR.Palette.textTertiary)
                }
            }
        }
    }

    private var locationSummary: String {
        switch location.state {
        case .denied: return "Allow location access to see hazards near you"
        case .notDetermined: return "Allow location access to see hazards near you"
        default: return "Finding your location…"
        }
    }

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
        } else if model.loadState.isLoading && model.hazards.isEmpty {
            StateBanner(text: "Loading nearby hazards…", systemImage: "hourglass")
        }
        switch location.state {
        case .denied:
            StateBanner(text: "SafeRoute can't use your location — alerts and routes need it", systemImage: "location.slash.fill",
                        tint: SR.Palette.warning, actionTitle: "Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            }
        case .unavailable where LocationManager.isSimulator:
            // The Simulator has no GPS: it reports nothing until a location is chosen.
            StateBanner(text: "The Simulator has no location set. In the Simulator menu choose Features ▸ Location ▸ Custom Location (e.g. 14.5547, 121.0244).",
                        systemImage: "location.slash", tint: SR.Palette.warning)
        case .unavailable:
            StateBanner(text: "Can't find your location right now", systemImage: "location.slash", tint: SR.Palette.warning,
                        actionTitle: "Retry") { location.refresh() }
        default:
            EmptyView()
        }
    }

    // MARK: Bottom — floating controls (review §4, §28, §29)

    private var bottomControls: some View {
        VStack(spacing: SR.Space.sm) {
            if let hazard = model.selectedHazard {
                SRHazardPreviewCard(
                    hazard: hazard,
                    distance: Format.distance(from: location.currentLocation, to: hazard.coordinate),
                    onDetails: { detailHazard = SelectedHazard(id: hazard.id) },
                    onSafeRoute: { isShowingPlanner = true },
                    onClose: { model.selectedHazardId = nil })
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else if let plan = model.plan {
                RouteComparisonCard(plan: plan, useSafer: $model.useSaferRoute,
                                    onClose: { model.clearRoute() },
                                    onSelectHazard: { model.selectedHazardId = $0 },
                                    onStart: startNavigation)
            } else {
                nearbySummary
            }

            HStack(spacing: SR.Space.sm) {
                Button { isShowingReport = true } label: {
                    Label("Report hazard", systemImage: "plus")
                }
                .buttonStyle(.srPrimary)
                .accessibilityHint("Starts a guided hazard report")

                Button {
                    if location.currentLocation != nil {
                        model.command = .init(command: .recenterOnUser)
                    } else if location.state == .denied {
                        appState.show(Toast(message: "Allow location access in Settings to center the map on you.",
                                            systemImage: "location.slash.fill", style: .warning))
                    } else {
                        location.refresh()
                        appState.show(Toast(message: LocationManager.isSimulator
                                            ? "No location yet. In the Simulator: Features ▸ Location ▸ Custom Location."
                                            : "Finding your location…",
                                            systemImage: "location", style: .info))
                    }
                } label: {
                    Image(systemName: "location.fill")
                        .font(SR.Font.cardTitle)
                        .foregroundStyle(SR.Palette.navy)
                        .frame(width: SR.Layout.buttonHeight, height: SR.Layout.buttonHeight)
                        .srGlassSurface(radius: SR.Radius.button)
                }
                .accessibilityLabel("Center on my location")
            }
        }
        .padding(.horizontal, SR.Space.screenMargin)
        .padding(.bottom, SR.Space.sm)
    }

    @ViewBuilder
    private var nearbySummary: some View {
        let nearby = model.nearbyActive
        if !nearby.isEmpty {
            SRGlassCard(padding: SR.Space.md) {
                Button {
                    withAnimation(motion) { isNearbyExpanded.toggle() }
                } label: {
                    HStack(spacing: SR.Space.sm) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(nearby.count) hazard\(nearby.count == 1 ? "" : "s") nearby")
                                .font(SR.Font.cardTitle)
                                .foregroundStyle(SR.Palette.textPrimary)
                            Text(severityBreakdown(nearby.map(\.hazard)))
                                .font(SR.Font.secondary)
                                .foregroundStyle(SR.Palette.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.up")
                            .rotationEffect(.degrees(isNearbyExpanded ? 0 : 180))
                            .foregroundStyle(SR.Palette.textSecondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(nearby.count) hazards within 1 kilometer, \(severityBreakdown(nearby.map(\.hazard)))")
                .accessibilityHint(isNearbyExpanded ? "Collapses the list" : "Shows the nearest hazards")

                if isNearbyExpanded {
                    ForEach(nearby.prefix(3), id: \.hazard.id) { item in
                        Button { model.selectedHazardId = item.hazard.id } label: {
                            HStack(spacing: SR.Space.sm) {
                                HazardIcon(type: item.hazard.type, severity: item.hazard.severity, size: 28)
                                Text(item.hazard.type.displayName).font(SR.Font.body).foregroundStyle(SR.Palette.textPrimary)
                                Spacer()
                                Text(Format.distance(item.distance)).font(SR.Font.secondary.monospacedDigit())
                                    .foregroundStyle(SR.Palette.textSecondary)
                            }
                            .frame(minHeight: SR.Layout.minTouchTarget)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(item.hazard.accessibilitySummary), \(Format.distance(item.distance)) away")
                    }
                }
            }
        } else if model.loadState == .loaded, location.currentLocation != nil {
            Label("No active hazards within 1 km", systemImage: "checkmark.shield")
                .font(SR.Font.secondary)
                .foregroundStyle(SR.Palette.textSecondary)
                .frame(maxWidth: .infinity, minHeight: SR.Layout.minTouchTarget)
                .srGlassSurface(radius: SR.Radius.button)
        }
    }

    private func severityBreakdown(_ hazards: [Hazard]) -> String {
        let counts = [(Severity.high, "high"), (.medium, "medium"), (.low, "low")]
            .map { severity, name in (hazards.filter { $0.severity == severity }.count, name) }
            .filter { $0.0 > 0 }
        return counts.map { "\($0.0) \($0.1)" }.joined(separator: " · ")
    }

    #if DEBUG
    /// SAFEROUTE_DEMO_OPEN=preview|detail|report|planner|filters — screenshot automation only.
    private func runDemoIntent() async {
        guard let intent = ProcessInfo.processInfo.environment["SAFEROUTE_DEMO_OPEN"] else { return }
        switch intent {
        case "report": isShowingReport = true
        case "planner": isShowingPlanner = true
        case "filters": isShowingFilters = true
        case "navigate":
            // SAFEROUTE_DEMO_ROUTE_TO="lat,lon,Name": plan a route and start navigation. The route's
            // coordinates are written to Documents/demo-route.txt so a walk can be simulated with
            // `xcrun simctl location <id> start`.
            let parts = (ProcessInfo.processInfo.environment["SAFEROUTE_DEMO_ROUTE_TO"] ?? "").split(separator: ",")
            guard parts.count >= 2, let lat = Double(parts[0]), let lon = Double(parts[1]) else { return }
            for _ in 0..<40 where location.currentLocation == nil { try? await Task.sleep(for: .milliseconds(250)) }
            guard let here = location.currentLocation,
                  let plan = try? await RouteAvoidanceService.shared.plan(
                    from: here, to: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                    destinationName: parts.count > 2 ? String(parts[2]) : "Destination") else { return }
            model.setPlan(plan)
            if let route = model.activeRoute {
                let text = route.coordinates.map { "\($0.latitude),\($0.longitude)" }.joined(separator: "\n")
                let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("demo-route.txt")
                try? text.write(to: url, atomically: true, encoding: .utf8)
            }
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

/// Floating preview shown when a pin is tapped, before the full detail sheet (review §28).
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

/// Map filters as chips (review §19, §46). Presented as a glass sheet.
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
