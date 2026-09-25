import Foundation

extension Notification.Name {
    /// Posted when the refresh token is rejected; AppState signs the user out.
    static let sessionExpired = Notification.Name("SafeRoute.sessionExpired")
}

/// REST client. Access tokens are short-lived (30 min): the client refreshes proactively when
/// the token is about to expire and reactively on a 401, then retries the request once.
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()
    private var refreshTask: Task<Bool, Never>?

    func send<T: Decodable>(_ endpoint: APIEndpoint, as type: T.Type) async throws -> T {
        try await sendWithResponse(endpoint, as: type).value
    }

    /// Also returns the HTTP response, for endpoints that report metadata in headers.
    func sendWithResponse<T: Decodable>(_ endpoint: APIEndpoint, as type: T.Type) async throws -> (value: T, response: HTTPURLResponse) {
        let (data, response) = try await rawSend(endpoint)
        do {
            return (try JSONDecoder.api.decode(T.self, from: data), response)
        } catch {
            throw APIError.decoding(error)
        }
    }

    func send(_ endpoint: APIEndpoint) async throws {
        _ = try await rawSend(endpoint)
    }

    /// A non-expired access token for the WebSocket handshake, refreshing first if needed.
    func validAccessToken() async -> String? {
        guard let token = KeychainService.shared.readAccessToken() else { return nil }
        if JWT.expiresSoon(token) {
            return await refreshTokens() ? KeychainService.shared.readAccessToken() : nil
        }
        return token
    }

    private func rawSend(_ endpoint: APIEndpoint, isRetry: Bool = false) async throws -> (Data, HTTPURLResponse) {
        if endpoint.requiresAuth, endpoint.bearerToken == nil, !isRetry,
           let token = KeychainService.shared.readAccessToken(), JWT.expiresSoon(token) {
            _ = await refreshTokens()
        }
        let request = buildRequest(endpoint)
        // Checked against the token actually attached, right before sending: no suspension point
        // lies between this check and the request leaving with that token.
        if let actingUserId = endpoint.actingUserId {
            let attached = request.value(forHTTPHeaderField: "Authorization").map { String($0.dropFirst("Bearer ".count)) }
            guard let attached, JWT.subject(attached) == actingUserId else { throw APIError.sessionChanged }
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed].contains(error.code) {
            throw APIError.offline
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.unknown }

        switch http.statusCode {
        case 200..<300:
            return (data, http)
        case 401 where endpoint.requiresAuth && endpoint.bearerToken == nil && !isRetry:
            if await refreshTokens() {
                return try await rawSend(endpoint, isRetry: true)
            }
            throw APIError.unauthorized
        case 401 where endpoint.requiresAuth:
            throw APIError.unauthorized
        default:
            let body = try? JSONDecoder.api.decode(APIErrorBody.self, from: data)
            let message = body?.message ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            if http.statusCode == 429 {
                let retry = body?.retryAfterSeconds ?? Int(http.value(forHTTPHeaderField: "Retry-After") ?? "")
                throw APIError.rateLimited(message: message, retryAfterSeconds: retry)
            }
            throw APIError.server(status: http.statusCode, code: body?.error ?? "HTTP_\(http.statusCode)", message: message)
        }
    }

    private func buildRequest(_ endpoint: APIEndpoint) -> URLRequest {
        var components = URLComponents(url: APIConfig.restBaseURL.appendingPathComponent(endpoint.path), resolvingAgainstBaseURL: false)!
        if !endpoint.query.isEmpty {
            components.queryItems = endpoint.query
        }
        var request = URLRequest(url: components.url!)
        request.httpMethod = endpoint.method
        request.httpBody = endpoint.body
        if endpoint.body != nil {
            request.setValue(endpoint.contentType, forHTTPHeaderField: "Content-Type")
        }
        if endpoint.requiresAuth, let token = endpoint.bearerToken ?? KeychainService.shared.readAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// Single-flight refresh: concurrent 401s share one refresh call (refresh tokens rotate, so
    /// two parallel refreshes would invalidate each other).
    private func refreshTokens() async -> Bool {
        if let refreshTask { return await refreshTask.value }
        let task = Task<Bool, Never> {
            guard let refreshToken = KeychainService.shared.readRefreshToken() else { return false }
            do {
                let data = try await rawSendUnauthenticated(.refresh(refreshToken))
                let response = try JSONDecoder.api.decode(AuthResponse.self, from: data)
                KeychainService.shared.save(accessToken: response.token, refreshToken: response.refreshToken)
                return true
            } catch APIError.server(let status, _, _) where status == 401 {
                await MainActor.run { NotificationCenter.default.post(name: .sessionExpired, object: nil) }
                return false
            } catch {
                return false // offline etc. — keep the session, try later
            }
        }
        refreshTask = task
        let result = await task.value
        refreshTask = nil
        return result
    }

    private func rawSendUnauthenticated(_ endpoint: APIEndpoint) async throws -> Data {
        let (data, response) = try await session.data(for: buildRequest(endpoint))
        guard let http = response as? HTTPURLResponse else { throw APIError.unknown }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.server(status: http.statusCode, code: "HTTP_\(http.statusCode)", message: "")
        }
        return data
    }
}

/// Minimal JWT payload reader — only used to decide *when* to refresh, never to trust claims.
enum JWT {
    static func expiresSoon(_ token: String, within seconds: TimeInterval = 60) -> Bool {
        guard let exp = payload(token)?["exp"] as? TimeInterval else { return false }
        return Date(timeIntervalSince1970: exp).timeIntervalSinceNow < seconds
    }

    /// The account the token was issued to (`sub`).
    static func subject(_ token: String) -> UUID? {
        (payload(token)?["sub"] as? String).flatMap(UUID.init(uuidString:))
    }

    private static func payload(_ token: String) -> [String: Any]? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var base64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        guard let data = Data(base64Encoded: base64) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
