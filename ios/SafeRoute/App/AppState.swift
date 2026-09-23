import Foundation
import Combine

@MainActor
final class AppState: ObservableObject {
    enum Tab: Hashable { case map, reports, alerts, profile }

    @Published var currentUser: CurrentUser?
    @Published var isBootstrapping = true
    @Published var selectedTab: Tab = .map
    @Published var toast: Toast?
    /// Cross-tab intents, e.g. "Report a Hazard" from the empty Reports tab.
    @Published var wantsReportFlow = false
    @Published var wantsRoutePlanner = false
    @Published var hazardToShow: UUID?
    /// Walking navigation takes over the screen (tab bar hidden).
    @Published var isNavigating = false

    let map = MapViewModel()
    let reports = ReportsStore()
    let alerts = AlertsStore()
    let meta = MetaStore()
    let offlineQueue = OfflineReportQueue()

    private let userKey = "saferoute.currentUser"
    private var sessionObserver: NSObjectProtocol?
    private var cancellables = Set<AnyCancellable>()

    init() {
        let socket = WebSocketClient.shared
        socket.onHazardFrame = { [weak self] frame in self?.handle(frame) }
        socket.onSubmissionFrame = { [weak self] frame in self?.reports.handle(frame) }
        map.onNavigationChange = { [weak self] navigating in self?.isNavigating = navigating }
        reports.onSubmissionFinished = { [weak self] status, hazardId, message in
            guard let self else { return }
            self.show(Toast(message: message,
                            systemImage: status == .failed ? "exclamationmark.octagon.fill" : status == .merged ? "arrow.triangle.merge" : "checkmark.circle.fill",
                            style: status == .failed ? .error : .success))
            if let hazardId { Task { await self.map.fetchAndUpsert(hazardId) } }
        }
        ConnectivityMonitor.shared.onReconnect = { [weak self] in
            guard let self, self.currentUser != nil else { return }
            Task { await self.flushOfflineQueue() }
            Task { await self.map.refresh() }
        }
        sessionObserver = NotificationCenter.default.addObserver(forName: .sessionExpired, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.currentUser != nil else { return }
                self.signOut(callServer: false)
                self.show(Toast(message: "Your session expired. Please log in again.", systemImage: "lock.fill", style: .warning))
            }
        }
        // Nested ObservableObjects don't propagate changes on their own.
        for publisher in [alerts.objectWillChange, reports.objectWillChange, offlineQueue.objectWillChange] {
            publisher.sink { [weak self] in self?.objectWillChange.send() }.store(in: &cancellables)
        }
    }

    func bootstrap() async {
        defer { isBootstrapping = false }
        #if DEBUG
        if await demoLogin() { return }
        #endif
        guard KeychainService.shared.readRefreshToken() != nil else { return }
        if let data = UserDefaults.standard.data(forKey: userKey),
           let cached = try? JSONDecoder.api.decode(CurrentUser.self, from: data) {
            currentUser = cached // lets the app open offline
        }
        do {
            let me = try await APIClient.shared.send(.me, as: CurrentUser.self)
            setUser(me)
        } catch APIError.unauthorized {
            signOut(callServer: false)
            return
        } catch {
            // Offline: keep the cached session; everything retries when connectivity returns.
            if currentUser == nil { return }
        }
        startSession()
    }

    func handleAuthSuccess(_ response: AuthResponse) {
        KeychainService.shared.save(accessToken: response.token, refreshToken: response.refreshToken)
        setUser(CurrentUser(id: response.userId, email: response.email, displayName: response.displayName, role: response.role))
        startSession()
    }

    func signOut(callServer: Bool = true) {
        if callServer, let refresh = KeychainService.shared.readRefreshToken() {
            Task { try? await APIClient.shared.send(.logout(refresh)) }
        }
        KeychainService.shared.deleteTokens()
        UserDefaults.standard.removeObject(forKey: userKey)
        WebSocketClient.shared.disconnect()
        map.reset()
        reports.reset()
        currentUser = nil
        selectedTab = .map
    }

    func show(_ toast: Toast) {
        self.toast = toast
        let id = toast.id
        Task {
            try? await Task.sleep(for: .seconds(4))
            if self.toast?.id == id { self.toast = nil }
        }
    }

    /// Submit a report; if the network is down, queue it for automatic retry.
    func submitReport(_ request: HazardSubmissionRequest, imageData: Data?) async -> Bool {
        do {
            var request = request
            if let imageData {
                let stored = try await APIClient.shared.send(.uploadHazardImage(jpeg: imageData), as: StoredImage.self)
                request.photoUrl = stored.url
            }
            let submission = try await APIClient.shared.send(.submitHazard(request), as: HazardSubmission.self)
            reports.track(submission, request: request)
            show(Toast(message: "Thanks for helping other commuters. Your report is being processed.",
                       systemImage: "hourglass", style: .info))
            return true
        } catch let error as APIError where error.isConnectivityProblem {
            offlineQueue.enqueue(request, imageData: imageData)
            show(Toast(message: "Report queued. It will be sent automatically when you're back online.",
                       systemImage: "tray.and.arrow.up.fill", style: .warning))
            return true
        } catch {
            show(Toast(message: error.localizedDescription, systemImage: "exclamationmark.triangle.fill", style: .error))
            return false
        }
    }

    func flushOfflineQueue() async {
        await offlineQueue.flush { [weak self] submission, request in
            self?.reports.track(submission, request: request)
        }
    }

    #if DEBUG
    /// Demo/automation hook: `SAFEROUTE_DEMO_EMAIL` + `SAFEROUTE_DEMO_PASSWORD` log in on launch,
    /// `SAFEROUTE_DEMO_TAB` (map|reports|alerts|profile) picks the first tab. Debug builds only.
    private func demoLogin() async -> Bool {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["SAFEROUTE_DEMO_EMAIL"], let password = env["SAFEROUTE_DEMO_PASSWORD"],
              let response = try? await APIClient.shared.send(.login(LoginRequest(email: email, password: password)), as: AuthResponse.self)
        else { return false }
        handleAuthSuccess(response)
        switch env["SAFEROUTE_DEMO_TAB"] {
        case "reports": selectedTab = .reports
        case "alerts": selectedTab = .alerts
        case "profile": selectedTab = .profile
        default: selectedTab = .map
        }
        return true
    }
    #endif

    private func setUser(_ user: CurrentUser) {
        currentUser = user
        UserDefaults.standard.set(try? JSONEncoder.api.encode(user), forKey: userKey)
    }

    private func startSession() {
        WebSocketClient.shared.connect()
        Task { await meta.refresh() }
        Task { await reports.load(reset: true) }
        Task { await flushOfflineQueue() }
    }

    private func handle(_ frame: HazardEventFrame) {
        map.apply(frame)
        guard frame.alert else { return }
        alerts.add(frame)
        map.showAlert(frame)
        NotificationManager.shared.postHazardAlert(frame: frame)
    }
}
