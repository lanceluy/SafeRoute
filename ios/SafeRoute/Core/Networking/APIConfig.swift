import Foundation

/// Where the backend lives. The iOS Simulator shares the Mac's network, so `localhost` reaches
/// `./mvnw spring-boot:run` or the dockerized backend directly. A physical iPhone can't use
/// `localhost` (that's the phone itself): it uses the server entered on the login screen, or the
/// one baked in at build time (`SAFEROUTE_DEFAULT_SERVER`, e.g. `http://my-mac.local:8080`).
enum APIConfig {
    /// The server typed on the login screen (physical devices only).
    static let serverDefaultsKey = "saferoute.serverURL"
    private static let simulatorServer = URL(string: "http://localhost:8080")!

    static var baseURL: URL {
        #if targetEnvironment(simulator)
        return simulatorServer
        #else
        if let saved = UserDefaults.standard.string(forKey: serverDefaultsKey), let url = normalized(saved) {
            return url
        }
        if let built = Bundle.main.object(forInfoDictionaryKey: "SafeRouteDefaultServer") as? String,
           let url = normalized(built) {
            return url
        }
        return simulatorServer
        #endif
    }

    static var restBaseURL: URL { baseURL.appendingPathComponent("api") }

    static var webSocketURL: URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws/notifications"
        return components.url!
    }

    /// Whether this build talks to a server the user picks (a real iPhone) rather than `localhost`.
    static var serverIsConfigurable: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        true
        #endif
    }

    /// Accepts what people type: `192.168.1.20`, `my-mac.local:8080`, `https://abc.ngrok.app`.
    /// Plain-HTTP addresses without a port get the backend's default 8080.
    static func normalized(_ text: String) -> URL? {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if !value.contains("://") { value = "http://" + value }
        guard var components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty else { return nil }
        if scheme == "http", components.port == nil { components.port = 8080 }
        components.path = ""
        components.query = nil
        return components.url
    }

    /// Uploaded photos come back as server-relative paths (/uploads/hazards/...).
    static func absoluteURL(for path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }
}
