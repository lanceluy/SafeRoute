import XCTest
@testable import SafeRoute

final class NearbyHazardListTests: XCTestCase {
    private let now = Date()

    private func item(_ type: HazardType, _ severity: Severity, meters: Double?, minutesAgo: Double = 5,
                      status: HazardStatus = .reported, confirmations: Int = 0) -> NearbyHazardList.Item {
        let hazard = Hazard(id: UUID(), type: type, latitude: Fixtures.origin.latitude, longitude: Fixtures.origin.longitude,
                            description: nil, photoUrl: nil, status: status, severity: severity,
                            severityAnswer: nil, confirmationCount: confirmations, disputeCount: 0, confidence: nil,
                            reporterId: nil, createdAt: now.addingTimeInterval(-minutesAgo * 60), updatedAt: now,
                            lastConfirmedAt: nil, expiresAt: nil, resolvedAt: nil, version: 0)
        return NearbyHazardList.Item(hazard: hazard, distance: meters)
    }

    func testCountsCoverEachSeverityIncludingZero() {
        let items = [item(.openManhole, .high, meters: 780), item(.construction, .medium, meters: 480),
                     item(.brokenSidewalk, .medium, meters: 720)]
        XCTAssertEqual(NearbyHazardList.counts(items), [.high: 1, .medium: 2, .low: 0])
    }

    func testSeverityAndTypeFiltersCombine() {
        let items = [item(.openManhole, .high, meters: 780), item(.construction, .medium, meters: 480),
                     item(.flooding, .medium, meters: 100)]
        let medium = NearbyHazardList.apply(items, severity: .medium, type: nil, sort: .nearest)
        XCTAssertEqual(medium.map(\.hazard.type), [.flooding, .construction])
        let mediumConstruction = NearbyHazardList.apply(items, severity: .medium, type: .construction, sort: .nearest)
        XCTAssertEqual(mediumConstruction.map(\.hazard.type), [.construction])
    }

    func testSortOrders() {
        let items = [item(.construction, .medium, meters: 480, minutesAgo: 8),
                     item(.openManhole, .high, meters: 780, minutesAgo: 5),
                     item(.poorLighting, .low, meters: 200, minutesAgo: 60)]
        XCTAssertEqual(NearbyHazardList.apply(items, severity: .all, type: nil, sort: .nearest).map(\.hazard.type),
                       [.poorLighting, .construction, .openManhole])
        XCTAssertEqual(NearbyHazardList.apply(items, severity: .all, type: nil, sort: .newest).map(\.hazard.type),
                       [.openManhole, .construction, .poorLighting])
        XCTAssertEqual(NearbyHazardList.apply(items, severity: .all, type: nil, sort: .severity).map(\.hazard.type),
                       [.openManhole, .construction, .poorLighting])
    }

    func testTrustWording() {
        XCTAssertEqual(NearbyHazardList.trust(item(.construction, .medium, meters: 1).hazard), "New report")
        XCTAssertEqual(NearbyHazardList.trust(item(.construction, .medium, meters: 1, confirmations: 1).hazard), "1 confirmation")
        XCTAssertEqual(NearbyHazardList.trust(item(.construction, .medium, meters: 1, confirmations: 3).hazard), "3 confirmations")
        XCTAssertEqual(NearbyHazardList.trust(item(.construction, .medium, meters: 1, status: .verified, confirmations: 4).hazard),
                       "Verified · 4 confirmations")
    }

    func testDetailedTrustAddsConfidenceOnlyWhenItHelps() {
        func hazard(_ status: HazardStatus, _ confidence: Confidence?, _ confirmations: Int) -> Hazard {
            Hazard(id: UUID(), type: .construction, latitude: 0, longitude: 0, description: nil, photoUrl: nil,
                   status: status, severity: .medium, severityAnswer: nil, confirmationCount: confirmations,
                   disputeCount: 0, confidence: confidence, reporterId: nil, createdAt: now, updatedAt: now,
                   lastConfirmedAt: nil, expiresAt: nil, resolvedAt: nil, version: 0)
        }
        XCTAssertEqual(NearbyHazardList.detailedTrust(hazard(.reported, .medium, 3)), "3 confirmations · Medium confidence")
        XCTAssertEqual(NearbyHazardList.detailedTrust(hazard(.reported, .unconfirmed, 0)), "New report")
        XCTAssertEqual(NearbyHazardList.detailedTrust(hazard(.disputed, .contested, 1)), "Disputed · 1 confirmation")
    }

    func testStaleReportsAreFlagged() {
        XCTAssertFalse(NearbyHazardList.isPossiblyOutdated(item(.flooding, .high, meters: 1, minutesAgo: 60).hazard, now: now))
        XCTAssertTrue(NearbyHazardList.isPossiblyOutdated(item(.flooding, .high, meters: 1, minutesAgo: 4 * 24 * 60).hazard, now: now))
    }

    func testSubtitleAndWalkingTime() {
        XCTAssertEqual(NearbyHazardList.subtitle(count: 7, hasLocation: true, radiusMeters: 1000), "7 reports within 1 km")
        XCTAssertEqual(NearbyHazardList.subtitle(count: 1, hasLocation: false, radiusMeters: 1000), "1 report in the visible map area")
        XCTAssertEqual(NearbyHazardList.walkingTime(480), "~6 min walk")
        XCTAssertNil(NearbyHazardList.walkingTime(40))
    }
}

final class FormatAgoTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-09-26T12:00:00Z")!

    func testRecentTimesMatchRelative() {
        XCTAssertEqual(Format.ago(now.addingTimeInterval(-30), now: now), "Just now")
        XCTAssertEqual(Format.ago(now.addingTimeInterval(-12 * 60), now: now), "12 min ago")
    }

    func testDaysAndWeeksInsteadOfDates() {
        XCTAssertEqual(Format.ago(now.addingTimeInterval(-2 * 86_400 - 60), now: now), "2 days ago")
        XCTAssertEqual(Format.ago(now.addingTimeInterval(-9 * 86_400), now: now), "1 week ago")
        XCTAssertEqual(Format.ago(now.addingTimeInterval(-20 * 86_400), now: now), "2 weeks ago")
    }

    func testOldReportsFallBackToTheDate() {
        XCTAssertFalse(Format.ago(now.addingTimeInterval(-60 * 86_400), now: now).contains("ago"))
    }
}
