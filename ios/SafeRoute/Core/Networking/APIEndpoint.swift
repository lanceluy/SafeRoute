import Foundation
import CoreLocation

struct APIEndpoint {
    let path: String
    var method: String = "GET"
    var query: [URLQueryItem] = []
    var body: Data?
    var contentType: String = "application/json"
    var requiresAuth: Bool = true
    /// If set, the request is sent only while the signed-in account is this user — so work
    /// queued by one account (offline reports, photo uploads) can never go out as another.
    var actingUserId: UUID?
    /// Sends with this access token instead of the Keychain's, e.g. to finish a call for an
    /// account that is signing out after its tokens have been cleared.
    var bearerToken: String?

    func acting(as userId: UUID?) -> APIEndpoint {
        var copy = self
        copy.actingUserId = userId
        return copy
    }

    func authorized(with token: String) -> APIEndpoint {
        var copy = self
        copy.bearerToken = token
        return copy
    }

    private static func json<T: Encodable>(_ path: String, _ method: String, _ body: T, auth: Bool = true) -> APIEndpoint {
        APIEndpoint(path: path, method: method, body: try? JSONEncoder.api.encode(body), requiresAuth: auth)
    }

    // MARK: Auth

    static func register(_ body: RegisterRequest) -> APIEndpoint { json("/auth/register", "POST", body, auth: false) }
    static func login(_ body: LoginRequest) -> APIEndpoint { json("/auth/login", "POST", body, auth: false) }
    static func refresh(_ token: String) -> APIEndpoint { json("/auth/refresh", "POST", RefreshRequest(refreshToken: token), auth: false) }
    static func logout(_ token: String) -> APIEndpoint { json("/auth/logout", "POST", RefreshRequest(refreshToken: token), auth: false) }
    static let me = APIEndpoint(path: "/auth/me")

    // MARK: Submissions

    static func submitHazard(_ request: HazardSubmissionRequest) -> APIEndpoint { json("/hazard-submissions", "POST", request) }
    static func submission(id: UUID) -> APIEndpoint { APIEndpoint(path: "/hazard-submissions/\(id.uuidString)") }

    // MARK: Hazards

    static func nearby(lat: Double, lon: Double, radiusMeters: Double? = nil, types: [HazardType]? = nil) -> APIEndpoint {
        var query = [URLQueryItem(name: "lat", value: "\(lat)"), URLQueryItem(name: "lon", value: "\(lon)")]
        if let radiusMeters { query.append(URLQueryItem(name: "radiusMeters", value: "\(Int(radiusMeters))")) }
        if let types, !types.isEmpty { query.append(URLQueryItem(name: "types", value: types.map(\.rawValue).joined(separator: ","))) }
        return APIEndpoint(path: "/hazards/nearby", query: query)
    }

    static func inBbox(minLat: Double, minLon: Double, maxLat: Double, maxLon: Double,
                       statuses: Set<HazardStatus>? = nil) -> APIEndpoint {
        var query = [
            URLQueryItem(name: "minLat", value: "\(minLat)"),
            URLQueryItem(name: "minLon", value: "\(minLon)"),
            URLQueryItem(name: "maxLat", value: "\(maxLat)"),
            URLQueryItem(name: "maxLon", value: "\(maxLon)"),
            URLQueryItem(name: "limit", value: "250")
        ]
        if let statuses, !statuses.isEmpty {
            query.append(URLQueryItem(name: "statuses", value: statuses.map(\.rawValue).sorted().joined(separator: ",")))
        }
        return APIEndpoint(path: "/hazards/in-bbox", query: query)
    }

    /// All active hazards along candidate routes, for route assessment (never recency-sampled).
    static func alongRoute(_ routes: [[CLLocationCoordinate2D]], corridorMeters: Double? = nil) -> APIEndpoint {
        json("/hazards/along-route", "POST", RouteHazardsRequest(routes: routes.map { $0.map { [$0.latitude, $0.longitude] } },
                                                                 corridorMeters: corridorMeters))
    }

    static func hazard(id: UUID) -> APIEndpoint { APIEndpoint(path: "/hazards/\(id.uuidString)") }
    static func history(id: UUID) -> APIEndpoint { APIEndpoint(path: "/hazards/\(id.uuidString)/history") }

    static func setConfirmation(id: UUID, action: ConfirmationAction) -> APIEndpoint {
        json("/hazards/\(id.uuidString)/confirmation", "PUT", ["action": action.rawValue])
    }

    static func resolutionVote(id: UUID, action: ResolutionAction) -> APIEndpoint {
        json("/hazards/\(id.uuidString)/resolution-confirmation", "POST", ["action": action.rawValue])
    }

    static func updateHazard(id: UUID, description: String? = nil, photoUrl: String? = nil) -> APIEndpoint {
        var body: [String: String] = [:]
        body["description"] = description
        body["photoUrl"] = photoUrl
        return json("/hazards/\(id.uuidString)", "PATCH", body)
    }

    static func moderatorResolve(id: UUID, note: String?) -> APIEndpoint {
        json("/hazards/\(id.uuidString)/resolve", "POST", ["note": note ?? ""])
    }

    static func moderatorReopen(id: UUID) -> APIEndpoint {
        APIEndpoint(path: "/hazards/\(id.uuidString)/reopen", method: "POST")
    }

    static func moderatorRemove(id: UUID, reason: String) -> APIEndpoint {
        APIEndpoint(path: "/hazards/\(id.uuidString)", method: "DELETE", query: [URLQueryItem(name: "reason", value: reason)])
    }

    // MARK: Me

    static func myReports(page: Int, size: Int = 20) -> APIEndpoint {
        APIEndpoint(path: "/me/reports", query: [URLQueryItem(name: "page", value: "\(page)"), URLQueryItem(name: "size", value: "\(size)")])
    }

    static let profile = APIEndpoint(path: "/me/profile")
    static let notificationPreferences = APIEndpoint(path: "/me/notification-preferences")

    static func updateNotificationPreferences(_ prefs: NotificationPreferences) -> APIEndpoint {
        json("/me/notification-preferences", "PUT", prefs)
    }

    // MARK: Background alerts (APNs)

    static func registerPushDevice(token: String) -> APIEndpoint {
        json("/me/push-device", "PUT", ["deviceToken": token])
    }

    static func unregisterPushDevice(token: String) -> APIEndpoint {
        APIEndpoint(path: "/me/push-device/\(token)", method: "DELETE")
    }

    static func updatePushDeviceLocation(token: String, _ coordinate: CLLocationCoordinate2D) -> APIEndpoint {
        json("/me/push-device/\(token)/location", "PUT", ["latitude": coordinate.latitude, "longitude": coordinate.longitude])
    }

    // MARK: Meta & uploads

    static let coverage = APIEndpoint(path: "/meta/coverage")
    static let severityQuestions = APIEndpoint(path: "/meta/severity-questions")
    static let routing = APIEndpoint(path: "/meta/routing")

    static func uploadHazardImage(jpeg: Data) -> APIEndpoint {
        let boundary = "SafeRoute-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"hazard.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(jpeg)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        return APIEndpoint(path: "/uploads/hazard-image", method: "POST", body: body,
                           contentType: "multipart/form-data; boundary=\(boundary)")
    }
}

extension JSONEncoder {
    static let api: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}

extension JSONDecoder {
    /// Backend timestamps carry fractional seconds (Instant), which `.iso8601` rejects.
    static let api: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            if let date = ISO8601.withFraction.date(from: string) ?? ISO8601.plain.date(from: string) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Bad date: \(string)")
        }
        return decoder
    }()
}

private enum ISO8601 {
    nonisolated(unsafe) static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    nonisolated(unsafe) static let plain = ISO8601DateFormatter()
}
