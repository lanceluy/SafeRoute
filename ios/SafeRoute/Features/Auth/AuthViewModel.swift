import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    enum Mode { case login, register }

    @Published var mode: Mode = .login
    @Published var email = ""
    @Published var password = ""
    @Published var displayName = ""
    @Published var isSubmitting = false
    @Published var errorMessage: String?

    func submit(appState: AppState) async {
        errorMessage = nil
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
            appState.handleAuthSuccess(response)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
