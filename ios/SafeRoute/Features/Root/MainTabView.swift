import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TabView(selection: $appState.selectedTab) {
            MapScreen(model: appState.map)
                .tag(AppState.Tab.map)
                .modifier(FloatingTabBarClearance(reserveSpace: !appState.isNavigating))
            MyReportsView(store: appState.reports, queue: appState.offlineQueue)
                .tag(AppState.Tab.reports)
                .modifier(FloatingTabBarClearance())
            AlertsView(store: appState.alerts)
                .tag(AppState.Tab.alerts)
                .modifier(FloatingTabBarClearance())
            ProfileView()
                .tag(AppState.Tab.profile)
                .modifier(FloatingTabBarClearance())
        }
        // Floats over every tab; the map stays visible behind it. Hidden during navigation.
        .overlay(alignment: .bottom) {
            if !appState.isNavigating { tabBar }
        }
        .animation(SR.Motion.standard(reduceMotion: reduceMotion), value: appState.isNavigating)
        .overlay(alignment: .top) {
            if let toast = appState.toast {
                ToastView(toast: toast)
                    .padding(.top, SR.Space.xxs)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { appState.toast = nil }
            }
        }
        .animation(SR.Motion.standard(reduceMotion: reduceMotion), value: appState.toast)
    }

    private var tabBar: some View {
            SRBottomNavigation(selection: $appState.selectedTab, items: [
                .init(tab: .map, title: "Map", systemImage: "map"),
                .init(tab: .reports, title: "Reports", systemImage: "list.bullet.rectangle",
                      badge: appState.reports.pending.count + appState.offlineQueue.items.count),
                .init(tab: .alerts, title: "Alerts", systemImage: "bell", badge: appState.alerts.unreadCount),
                .init(tab: .profile, title: "You", systemImage: "person.crop.circle")
            ])
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// Hides the system tab bar and reserves room for the floating one, so each tab's own content
/// (scroll views, the map's bottom controls) ends above it. Applied per tab: a safe-area inset
/// on the TabView itself doesn't reach its pages.
private struct FloatingTabBarClearance: ViewModifier {
    var reserveSpace = true

    func body(content: Content) -> some View {
        content
            .toolbar(.hidden, for: .tabBar)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: reserveSpace ? SR.Layout.tabBarClearance : 0).accessibilityHidden(true)
            }
    }
}
