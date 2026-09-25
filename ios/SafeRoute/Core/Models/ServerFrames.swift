import Foundation

/// hazard_created | hazard_verified | hazard_disputed | hazard_resolved | hazard_expired | hazard_updated
struct HazardEventFrame: Codable, Identifiable, Hashable {
    let type: String
    let change: String
    let hazardId: UUID
    let hazardType: HazardType
    let latitude: Double
    let longitude: Double
    let status: HazardStatus
    let severity: Severity
    let confirmationCount: Int
    let disputeCount: Int
    let distanceMeters: Double
    /// Server decided this is worth interrupting the user for (new/newly verified, enabled type, relevant).
    let alert: Bool
    let onRoute: Bool
    let distanceAheadMeters: Double?
    let occurredAt: Date?
    /// Hazard row version; older frames than the stored snapshot are ignored.
    let version: Int64?

    var id: String { "\(hazardId.uuidString)-\(change)-\(occurredAt?.timeIntervalSince1970 ?? 0)" }

    var alertTitle: String {
        if onRoute { return "\(hazardType.displayName) ahead" }
        return change == "VERIFIED" ? "\(hazardType.displayName) confirmed nearby" : "\(hazardType.displayName) reported nearby"
    }

    var alertSubtitle: String {
        if onRoute, let ahead = distanceAheadMeters {
            return "Approximately \(Format.distance(ahead)) along your route"
        }
        return "About \(Format.distance(distanceMeters)) away"
    }
}

struct SubmissionProcessedFrame: Codable {
    let type: String
    let submissionId: UUID
    let status: SubmissionStatus
    let hazardId: UUID?
    let message: String?
}

enum ServerFrame {
    case hazard(HazardEventFrame)
    case submission(SubmissionProcessedFrame)

    private struct Envelope: Decodable { let type: String }

    static func decode(_ data: Data) -> ServerFrame? {
        guard let envelope = try? JSONDecoder.api.decode(Envelope.self, from: data) else { return nil }
        if envelope.type == "submission_processed" {
            return (try? JSONDecoder.api.decode(SubmissionProcessedFrame.self, from: data)).map(ServerFrame.submission)
        }
        if envelope.type.hasPrefix("hazard_") {
            return (try? JSONDecoder.api.decode(HazardEventFrame.self, from: data)).map(ServerFrame.hazard)
        }
        return nil
    }
}
