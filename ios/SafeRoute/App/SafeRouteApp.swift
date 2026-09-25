import SwiftUI

@main
struct SafeRouteApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                // Brand navy replaces the default system blue everywhere.
                .tint(SR.Palette.navy)
                .task {
                    await appState.bootstrap()
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Group {
            if appState.isBootstrapping {
                ProgressView("Loading SafeRoute…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .srPageBackground()
            } else if appState.currentUser != nil {
                MainTabView()
            } else {
                AuthView()
            }
        }
    }
}
