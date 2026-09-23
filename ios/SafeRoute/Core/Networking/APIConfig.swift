import Foundation

/// Points at a locally-run backend. The iOS Simulator shares the host's network, so
/// `localhost` reaches `./mvnw spring-boot:run` or the dockerized backend directly.
/// A physical device would need the host's LAN IP instead — out of scope for this build.
enum APIConfig {
    static let baseURL = URL(string: "http://localhost:8080")!
    static let restBaseURL = baseURL.appendingPathComponent("api")
    static let webSocketURL = URL(string: "ws://localhost:8080/ws/notifications")!

    /// Uploaded photos come back as server-relative paths (/uploads/hazards/...).
    static func absoluteURL(for path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }
}
