import Foundation
import CoreLocation

/// Raw WebSocket client (not STOMP) matching the backend's plain `WebSocketHandler` at
/// /ws/notifications. Authenticates with an `Authorization` header only — tokens in URLs end up
/// in logs. Auto-reconnects with exponential backoff since a commuter's connection drops often.
@MainActor
final class WebSocketClient: NSObject, ObservableObject {
    enum State: Equatable { case disconnected, connecting, connected, reconnecting }

    static let shared = WebSocketClient()

    @Published private(set) var state: State = .disconnected

    var onHazardFrame: ((HazardEventFrame) -> Void)?
    var onSubmissionFrame: ((SubmissionProcessedFrame) -> Void)?

    private var task: URLSessionWebSocketTask?
    private var session: URLSession!
    private var lastLocation: CLLocationCoordinate2D?
    private var activeRoute: [CLLocationCoordinate2D]?
    private var reconnectAttempt = 0
    private var shouldBeConnected = false
    private var reconnectWork: Task<Void, Never>?

    override private init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    func connect() {
        shouldBeConnected = true
        guard task == nil else { return }
        state = reconnectAttempt == 0 ? .connecting : .reconnecting
        Task {
            // Refresh first if the 30-minute access token is about to lapse; the handshake
            // would otherwise fail with 401 forever.
            guard let token = await APIClient.shared.validAccessToken() else {
                self.state = .disconnected
                return
            }
            guard self.shouldBeConnected, self.task == nil else { return }
            var request = URLRequest(url: APIConfig.webSocketURL)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let newTask = self.session.webSocketTask(with: request)
            self.task = newTask
            newTask.resume()
            self.listen(on: newTask)
        }
    }

    func disconnect() {
        shouldBeConnected = false
        reconnectWork?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        reconnectAttempt = 0
        activeRoute = nil
        state = .disconnected
    }

    func updateLocation(_ coordinate: CLLocationCoordinate2D) {
        lastLocation = coordinate
        send(["type": "subscribe", "lat": coordinate.latitude, "lon": coordinate.longitude])
    }

    /// Enables on-route alerts: the server flags hazards within its corridor and ahead of us.
    func updateRoute(_ coordinates: [CLLocationCoordinate2D]?) {
        activeRoute = coordinates.map { Self.downsample($0, maxPoints: 400) }
        sendRoute()
    }

    private func sendRoute() {
        let points: Any = activeRoute.map { $0.map { [$0.latitude, $0.longitude] } } ?? NSNull()
        send(["type": "route", "route": points])
    }

    private func send(_ frame: [String: Any]) {
        guard let task, state == .connected,
              let data = try? JSONSerialization.data(withJSONObject: frame),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    private func listen(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === task else { return }
                switch result {
                case .success(.string(let text)):
                    if let data = text.data(using: .utf8), let frame = ServerFrame.decode(data) {
                        switch frame {
                        case .hazard(let f): self.onHazardFrame?(f)
                        case .submission(let f): self.onSubmissionFrame?(f)
                        }
                    }
                    self.listen(on: task)
                case .success:
                    self.listen(on: task)
                case .failure:
                    self.handleDisconnect()
                }
            }
        }
    }

    private func handleDisconnect() {
        task = nil
        guard shouldBeConnected else {
            state = .disconnected
            return
        }
        state = .reconnecting
        reconnectAttempt += 1
        let delay = min(30.0, pow(2.0, Double(reconnectAttempt)))
        reconnectWork?.cancel()
        reconnectWork = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.connect()
        }
    }

    private func didOpen() {
        state = .connected
        reconnectAttempt = 0
        if let lastLocation { updateLocation(lastLocation) }
        if activeRoute != nil { sendRoute() }
    }

    private static func downsample(_ points: [CLLocationCoordinate2D], maxPoints: Int) -> [CLLocationCoordinate2D] {
        guard points.count > maxPoints else { return points }
        let stride = Double(points.count - 1) / Double(maxPoints - 1)
        return (0..<maxPoints).map { points[Int((Double($0) * stride).rounded())] }
    }
}

extension WebSocketClient: URLSessionWebSocketDelegate {
    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                                didOpenWithProtocol protocol: String?) {
        Task { @MainActor in
            guard self.task === webSocketTask else { return }
            self.didOpen()
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        Task { @MainActor in
            guard self.task === task else { return }
            self.handleDisconnect()
        }
    }
}
