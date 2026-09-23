import Foundation

struct AuthResponse: Codable {
    let token: String
    let refreshToken: String
    let expiresInSeconds: Int
    let userId: UUID
    let email: String
    let displayName: String
    let role: String
}

struct RegisterRequest: Codable {
    let email: String
    let password: String
    let displayName: String
}

struct LoginRequest: Codable {
    let email: String
    let password: String
}

struct RefreshRequest: Codable {
    let refreshToken: String
}

/// Mirrors the backend's `GET /api/auth/me`.
struct CurrentUser: Codable, Equatable {
    let id: UUID
    let email: String
    var displayName: String?
    var role: String?
    var trustLevel: TrustLevel?

    var canModerate: Bool { role == "MODERATOR" || role == "MUNICIPAL_OFFICIAL" }
}
