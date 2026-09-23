import Foundation
import Network

@MainActor
final class ConnectivityMonitor: ObservableObject {
    static let shared = ConnectivityMonitor()

    @Published private(set) var isOnline = true
    /// Fires on every offline -> online transition (flush queued reports, reload the map).
    var onReconnect: (() -> Void)?

    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                let cameBack = online && !self.isOnline
                self.isOnline = online
                if cameBack { self.onReconnect?() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "SafeRoute.connectivity"))
    }
}
