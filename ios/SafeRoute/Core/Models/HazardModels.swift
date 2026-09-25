import Foundation
import CoreLocation
import SwiftUI

/// Decodes unknown future enum values as `.unknown` instead of failing the whole response.
protocol TolerantDecodableEnum: RawRepresentable, Decodable where RawValue == String {
    static var unknownCase: Self { get }
}

extension TolerantDecodableEnum {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.unknownCase
    }
}

enum HazardType: String, Codable, CaseIterable, Identifiable, TolerantDecodableEnum {
    case flooding = "FLOODING"
    case brokenSidewalk = "BROKEN_SIDEWALK"
    case openManhole = "OPEN_MANHOLE"
    case poorLighting = "POOR_LIGHTING"
    case accessibilityBarrier = "ACCESSIBILITY_BARRIER"
    case construction = "CONSTRUCTION"
    case pathObstruction = "PATH_OBSTRUCTION"
    case unknown = "UNKNOWN"

    static var unknownCase: HazardType { .unknown }
    static var reportable: [HazardType] { allCases.filter { $0 != .unknown } }

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .flooding: return "Flooding"
        case .brokenSidewalk: return "Broken Sidewalk"
        case .openManhole: return "Open Manhole"
        case .poorLighting: return "Poor Lighting"
        case .accessibilityBarrier: return "Accessibility Barrier"
        case .construction: return "Construction"
        case .pathObstruction: return "Path Obstruction"
        case .unknown: return "Hazard"
        }
    }

    /// Distinct glyph per type so type is never communicated by color alone.
    var symbolName: String {
        switch self {
        case .flooding: return "water.waves"
        case .brokenSidewalk: return "square.split.diagonal.2x2"
        case .openManhole: return "circle.circle"
        case .poorLighting: return "lightbulb.slash.fill"
        case .accessibilityBarrier: return "figure.roll"
        case .construction: return "cone.fill"
        case .pathObstruction: return "xmark.octagon.fill"
        case .unknown: return "exclamationmark.triangle.fill"
        }
    }

    var shortDescription: String {
        switch self {
        case .flooding: return "Standing water on the walkway"
        case .brokenSidewalk: return "Cracked, uneven or missing pavement"
        case .openManhole: return "Uncovered drain or manhole"
        case .poorLighting: return "Dark stretch at night"
        case .accessibilityBarrier: return "Blocks wheelchairs, strollers or canes"
        case .construction: return "Works narrowing or closing the path"
        case .pathObstruction: return "Vehicles, vendors or debris in the way"
        case .unknown: return ""
        }
    }
}

enum HazardStatus: String, Codable, CaseIterable, TolerantDecodableEnum {
    case reported = "REPORTED"
    case verified = "VERIFIED"
    case disputed = "DISPUTED"
    case resolved = "RESOLVED"
    case expired = "EXPIRED"
    case removed = "REMOVED"
    case unknown = "UNKNOWN"

    static var unknownCase: HazardStatus { .unknown }
    static let active: Set<HazardStatus> = [.reported, .verified, .disputed]

    var isActive: Bool { Self.active.contains(self) }

    var label: String {
        switch self {
        case .reported: return "Reported"
        case .verified: return "Verified"
        case .disputed: return "Community disagreement"
        case .resolved: return "Resolved"
        case .expired: return "No longer active"
        case .removed: return "Removed by moderator"
        case .unknown: return "Unknown"
        }
    }

    var symbolName: String {
        switch self {
        case .reported: return "exclamationmark.bubble"
        case .verified: return "checkmark.seal.fill"
        case .disputed: return "questionmark.diamond.fill"
        case .resolved: return "checkmark.circle"
        case .expired: return "clock.badge.xmark"
        case .removed: return "trash"
        case .unknown: return "questionmark"
        }
    }

    /// Status is shown subtly: brand navy while active, semantic color only where it adds meaning.
    var color: Color {
        switch self {
        case .reported, .verified: return SR.Palette.navy
        case .disputed: return SR.Palette.warning
        case .resolved: return SR.Palette.safe
        case .expired, .removed, .unknown: return SR.Palette.textSecondary
        }
    }
}

enum Severity: String, Codable, Comparable, TolerantDecodableEnum {
    case low = "LOW"
    case medium = "MEDIUM"
    case high = "HIGH"
    case unknown = "UNKNOWN"

    static var unknownCase: Severity { .unknown }

    private var rank: Int {
        switch self {
        case .unknown: return 0
        case .low: return 1
        case .medium: return 2
        case .high: return 3
        }
    }

    static func < (lhs: Severity, rhs: Severity) -> Bool { lhs.rank < rhs.rank }

    var label: String {
        switch self {
        case .low: return "Low severity"
        case .medium: return "Medium severity"
        case .high: return "High severity"
        case .unknown: return "Severity unknown"
        }
    }

    var shortLabel: String {
        switch self {
        case .low: return "Low"
        case .medium: return "Medium"
        case .high: return "High"
        case .unknown: return "Unknown"
        }
    }

    var color: Color {
        switch self {
        case .high: return SR.Palette.critical
        case .medium: return SR.Palette.warning
        case .low: return SR.Palette.caution
        case .unknown: return SR.Palette.textSecondary
        }
    }

    /// Map marker palette: strong red only for high severity, muted amber for medium, so the map
    /// stays readable when many hazards are shown.
    var markerColor: UIColor {
        switch self {
        case .high: return .systemRed
        case .medium: return UIColor(red: 0.85, green: 0.62, blue: 0.27, alpha: 1)
        case .low: return UIColor(red: 0.62, green: 0.60, blue: 0.42, alpha: 1)
        case .unknown: return .systemGray
        }
    }

    var uiColor: UIColor {
        switch self {
        case .high: return .systemRed
        case .medium: return .systemOrange
        case .low: return UIColor(red: 0.80, green: 0.62, blue: 0.0, alpha: 1) // darker yellow for contrast
        case .unknown: return .systemGray
        }
    }

    var symbolName: String {
        switch self {
        case .high: return "exclamationmark.3"
        case .medium: return "exclamationmark.2"
        case .low, .unknown: return "exclamationmark"
        }
    }
}

enum Confidence: String, Codable, TolerantDecodableEnum {
    case unconfirmed = "UNCONFIRMED"
    case low = "LOW"
    case medium = "MEDIUM"
    case high = "HIGH"
    case contested = "CONTESTED"
    case unknown = "UNKNOWN"

    static var unknownCase: Confidence { .unknown }

    var label: String {
        switch self {
        case .unconfirmed: return "Not yet confirmed"
        case .low: return "Low confidence"
        case .medium: return "Medium confidence"
        case .high: return "High confidence"
        case .contested: return "Community reports disagree"
        case .unknown: return ""
        }
    }
}

enum ConfirmationAction: String, Codable, TolerantDecodableEnum {
    case verify = "VERIFY"
    case dispute = "DISPUTE"
    case unknown = "UNKNOWN"
    static var unknownCase: ConfirmationAction { .unknown }
}

enum ResolutionAction: String, Codable, TolerantDecodableEnum {
    case noLongerPresent = "NO_LONGER_PRESENT"
    case stillPresent = "STILL_PRESENT"
    case unknown = "UNKNOWN"
    static var unknownCase: ResolutionAction { .unknown }
}

enum TrustLevel: String, Codable, TolerantDecodableEnum {
    case newReporter = "NEW_REPORTER"
    case regularReporter = "REGULAR_REPORTER"
    case trustedReporter = "TRUSTED_REPORTER"
    case unknown = "UNKNOWN"
    static var unknownCase: TrustLevel { .unknown }

    var label: String {
        switch self {
        case .newReporter: return "New Reporter"
        case .regularReporter: return "Regular Reporter"
        case .trustedReporter: return "Trusted Reporter"
        case .unknown: return "Reporter"
        }
    }

    var symbolName: String {
        switch self {
        case .trustedReporter: return "star.circle.fill"
        case .regularReporter: return "person.crop.circle.badge.checkmark"
        case .newReporter, .unknown: return "person.crop.circle"
        }
    }
}

struct Hazard: Codable, Identifiable, Hashable {
    let id: UUID
    var type: HazardType
    var latitude: Double
    var longitude: Double
    var description: String?
    var photoUrl: String?
    var status: HazardStatus
    var severity: Severity
    var severityAnswer: String?
    var confirmationCount: Int
    var disputeCount: Int
    var confidence: Confidence?
    let reporterId: UUID?
    let createdAt: Date
    var updatedAt: Date
    var lastConfirmedAt: Date?
    var expiresAt: Date?
    var resolvedAt: Date?
    /// Server row version. Snapshots can arrive out of order (REST vs WebSocket, two Kafka
    /// topics), so the store keeps the highest version it has seen.
    var version: Int64?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var accessibilitySummary: String {
        var parts = [type.displayName, severity.label, status.label]
        if confirmationCount > 0 { parts.append("\(confirmationCount) confirmation\(confirmationCount == 1 ? "" : "s")") }
        if disputeCount > 0 { parts.append("\(disputeCount) dispute\(disputeCount == 1 ? "" : "s")") }
        return parts.joined(separator: ", ")
    }
}

struct HazardDetail: Codable {
    struct Viewer: Codable {
        let isReporter: Bool
        let confirmation: ConfirmationAction?
        let resolutionVote: ResolutionAction?
        let canEdit: Bool
        let canModerate: Bool
    }

    struct Community: Codable {
        let confirmations: Int
        let disputes: Int
        let noLongerPresentVotes: Int
        let stillPresentVotes: Int
        let resolutionThreshold: Int
    }

    var hazard: Hazard
    let reporterTrustLevel: TrustLevel
    var viewer: Viewer
    var community: Community
    let expiringSoon: Bool
}

struct TimelineEntry: Codable, Identifiable {
    let id: UUID
    let action: String
    let field: String?
    let oldValue: String?
    let newValue: String?
    let note: String?
    let actor: String
    let at: Date

    /// Human-readable line, e.g. "Confirmed by a commuter" or "Status: Reported → Verified".
    var title: String {
        switch action {
        case "CREATED": return "Reported"
        case "DUPLICATE_MERGED": return actor == "REPORTER" ? "Reported again by the reporter" : "Matching report merged in"
        case "CONFIRMATION_CHANGED":
            if newValue == "VERIFY" { return oldValue == "DISPUTE" ? "A commuter changed to confirm" : "Confirmed by a commuter" }
            return oldValue == "VERIFY" ? "A commuter changed to dispute" : "Disputed by a commuter"
        case "RESOLUTION_VOTE":
            return newValue == "STILL_PRESENT" ? "A commuter says it's still there" : "A commuter says it's gone"
        case "STATUS_CHANGED":
            let from = oldValue.flatMap(HazardStatus.init(rawValue:))?.label ?? "—"
            let to = newValue.flatMap(HazardStatus.init(rawValue:))?.label ?? "—"
            return "\(from) → \(to)"
        case "FIELD_EDITED": return "\((field ?? "Details").capitalized) updated"
        case "MODERATOR_RESOLVED": return "Resolved by a moderator"
        case "MODERATOR_REOPENED": return "Reopened by a moderator"
        case "MODERATOR_REMOVED": return "Removed by a moderator"
        default: return action.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    /// Notes worth showing people; internal bookkeeping (submission ids, counters) stays hidden.
    var displayNote: String? {
        guard let note, !note.isEmpty, action != "DUPLICATE_MERGED", action != "CREATED",
              !note.hasPrefix("Submission "), !note.contains("confirmation(s)") else { return nil }
        return note
    }

    var symbolName: String {
        switch action {
        case "CREATED": return "plus.circle.fill"
        case "CONFIRMATION_CHANGED": return newValue == "VERIFY" ? "hand.thumbsup.fill" : "hand.thumbsdown.fill"
        case "RESOLUTION_VOTE": return newValue == "STILL_PRESENT" ? "eye.fill" : "eye.slash.fill"
        case "STATUS_CHANGED": return "arrow.triangle.2.circlepath"
        case "DUPLICATE_MERGED": return "arrow.triangle.merge"
        case "FIELD_EDITED": return "pencil"
        default: return action.hasPrefix("MODERATOR") ? "shield.fill" : "circle.fill"
        }
    }
}

enum SubmissionStatus: String, Codable, TolerantDecodableEnum {
    case queued = "QUEUED"
    case created = "CREATED"
    case merged = "MERGED"
    case failed = "FAILED"
    case unknown = "UNKNOWN"
    static var unknownCase: SubmissionStatus { .unknown }

    var isTerminal: Bool { self == .created || self == .merged || self == .failed }
}

struct HazardSubmission: Codable, Identifiable {
    let submissionId: UUID
    let status: SubmissionStatus
    let hazardId: UUID?
    let submittedType: HazardType
    let latitude: Double
    let longitude: Double
    let failureReason: String?
    let createdAt: Date
    let processedAt: Date?
    var clientRequestId: UUID?

    var id: UUID { submissionId }
}

struct HazardSubmissionRequest: Codable, Equatable {
    let type: HazardType
    let latitude: Double
    let longitude: Double
    var description: String?
    var photoUrl: String?
    var severityAnswer: String?
    /// Idempotency key, generated once per logical report: retries (including from the offline
    /// queue) return the original submission instead of creating another.
    var clientRequestId: UUID?
    /// When the reporter saw the hazard; freshness is measured from it, not from upload time.
    var observedAt: Date?
}

struct MyReport: Codable, Identifiable {
    let submission: HazardSubmission
    let hazard: Hazard?
    let mergedIntoExisting: Bool

    var id: UUID { submission.submissionId }

    /// The single state shown to the reporter.
    var displayState: (label: String, symbol: String, color: Color) {
        switch submission.status {
        case .queued: return ("Processing", "hourglass", SR.Palette.textSecondary)
        case .failed: return ("Couldn't be sent", "exclamationmark.octagon.fill", SR.Palette.critical)
        default:
            guard let hazard else { return ("Processing", "hourglass", SR.Palette.textSecondary) }
            if mergedIntoExisting && hazard.status.isActive {
                return ("Joined an existing report", "arrow.triangle.merge", hazard.status.color)
            }
            return (hazard.status.label, hazard.status.symbolName, hazard.status.color)
        }
    }
}

struct PageResponse<T: Codable & Sendable>: Codable, Sendable {
    let items: [T]
    let page: Int
    let size: Int
    let totalItems: Int
    let hasMore: Bool
}

struct CommandAccepted: Codable {
    let hazardId: UUID
    let action: String
    let status: String
}

struct StoredImage: Codable {
    let url: String
    let width: Int
    let height: Int
    let bytes: Int
}

struct SeverityQuestion: Codable, Identifiable {
    struct Option: Codable, Identifiable, Hashable {
        let value: String
        let label: String
        let severity: Severity
        var id: String { value }
    }

    let type: HazardType
    let prompt: String
    let options: [Option]
    var id: String { type.rawValue }
}

struct CoverageArea: Codable {
    let enabled: Bool
    let name: String
    let minLat: Double
    let maxLat: Double
    let minLon: Double
    let maxLon: Double

    func contains(_ c: CLLocationCoordinate2D) -> Bool {
        !enabled || (c.latitude >= minLat && c.latitude <= maxLat && c.longitude >= minLon && c.longitude <= maxLon)
    }

    var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
    }
}

struct NotificationPreferences: Codable, Equatable {
    var radiusMeters: Int
    var enabledTypes: Set<HazardType>

    static let `default` = NotificationPreferences(radiusMeters: 400, enabledTypes: Set(HazardType.reportable))
}

struct Profile: Codable {
    struct Stats: Codable {
        let reportsSubmitted: Int
        let reportsVerified: Int
        let communityConfirmations: Int
        let disputesFiled: Int
    }

    struct Activity: Codable, Identifiable {
        let reason: String
        let delta: Int
        let hazardId: UUID?
        let hazardType: HazardType?
        let at: Date
        var id: String { "\(reason)-\(hazardId?.uuidString ?? "")-\(at.timeIntervalSince1970)" }

        var title: String {
            let type = hazardType?.displayName ?? "Hazard"
            switch reason {
            case "REPORT_VERIFIED": return "\(type) report verified"
            case "CORRECT_VERIFICATION": return "Confirmed \(type.lowercased())"
            case "CORRECT_DISPUTE": return "Correctly disputed \(type.lowercased())"
            case "REPORT_REMOVED": return "\(type) report removed"
            default: return reason.replacingOccurrences(of: "_", with: " ").capitalized
            }
        }
    }

    let id: UUID
    let email: String
    let displayName: String
    let role: String
    let reputationScore: Int
    let trustLevel: TrustLevel
    let pointsToNextLevel: Int?
    let stats: Stats
    let recentActivity: [Activity]
}
