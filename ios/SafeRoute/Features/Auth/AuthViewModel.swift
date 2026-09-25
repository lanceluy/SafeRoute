import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    enum Mode { case login, register }

    @Published var mode: Mode = .login
    @Published var email = ""
    @Published var password = ""
    @Published var displayName = ""
    /// Only used on a real iPhone (see APIConfig).
    @Published var server = APIConfig.serverIsConfigurable ? APIConfig.baseURL.absoluteString : ""
    @Published var isSubmitting = false
    @Published var errorMessage: String?

    func submit(appState: AppState) async {
        errorMessage = nil
        if APIConfig.serverIsConfigurable {
            guard let url = APIConfig.normalized(server) else {
                errorMessage = "Enter the server address, for example http://192.168.1.20:8080."
                return
            }
            UserDefaults.standard.set(url.absoluteString, forKey: APIConfig.serverDefaultsKey)
            server = url.absoluteString
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let response: AuthResponse
            switch mode {
            case .login:
                response = try await APIClient.shared.send(.login(LoginRequest(email: email, password: password)), as: AuthResponse.self)
            case .register:
                response = try await APIClient.shared.send(.register(RegisterRequest(email: email, password: password, displayName: displayName)), as: AuthResponse.self)
            }
            try appState.handleAuthSuccess(response)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
