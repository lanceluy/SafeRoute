import Foundation

struct APIErrorBody: Codable {
    let status: Int
    let error: String
    let message: String?
    let retryAfterSeconds: Int?
}

enum APIError: Error, LocalizedError {
    case unauthorized
    case offline
    case rateLimited(message: String, retryAfterSeconds: Int?)
    /// `code` is the backend's stable error code, e.g. SELF_CONFIRMATION_NOT_ALLOWED.
    case server(status: Int, code: String, message: String)
    case decoding(Error)
    case transport(Error)
    case unknown

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Your session expired. Please log in again."
        case .offline:
            return "You're offline. Check your connection and try again."
        case .rateLimited(let message, _):
            return message
        case .server(_, _, let message):
            return message
        case .decoding:
            return "Received an unexpected response from the server."
        case .transport:
            return "Couldn't reach SafeRoute. Try again in a moment."
        case .unknown:
            return "Something went wrong."
        }
    }

    var code: String? {
        if case .server(_, let code, _) = self { return code }
        return nil
    }

    /// Worth keeping the request and retrying later (as opposed to a validation error).
    var isConnectivityProblem: Bool {
        switch self {
        case .offline, .transport: return true
        case .server(let status, _, _): return status >= 500
        default: return false
        }
    }
}
