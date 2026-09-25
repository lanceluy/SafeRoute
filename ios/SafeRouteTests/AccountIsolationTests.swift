import XCTest
import CoreLocation
@testable import SafeRoute

/// F03: work and history belong to the account that created them.
@MainActor
final class AccountIsolationTests: XCTestCase {

    private var root: URL!
    private let alice = UUID()
    private let bob = UUID()
    private let request = HazardSubmissionRequest(type: .openManhole, latitude: 14.5547, longitude: 121.0244)

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("queue-\(UUID().uuidString)")
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testAQueuedReportIsOnlyVisibleToItsOwner() throws {
        let queue = OfflineReportQueue(root: root)
        queue.activate(ownerId: alice)
        try queue.enqueue(request, imageData: Data([0xFF, 0xD8, 0xFF]))
        queue.deactivate()

        queue.activate(ownerId: bob)
        XCTAssertTrue(queue.items.isEmpty, "Bob must not see (or send) Alice's queued report")

        queue.activate(ownerId: alice)
        XCTAssertEqual(queue.items.count, 1)
        XCTAssertEqual(queue.items.first?.ownerId, alice)
    }

    func testQueuedReportsKeepTheirIdempotencyKeyAndObservationTime() throws {
        let queue = OfflineReportQueue(root: root)
        queue.activate(ownerId: alice)
        try queue.enqueue(request, imageData: nil)

        let queued = try XCTUnwrap(queue.items.first?.request)
        XCTAssertNotNil(queued.clientRequestId)
        XCTAssertNotNil(queued.observedAt)
    }

    func testNothingCanBeQueuedWhileSignedOut() {
        let queue = OfflineReportQueue(root: root)
        XCTAssertThrowsError(try queue.enqueue(request, imageData: nil))
    }

    // 7.5: a disk failure is reported, not silently swallowed behind a "queued" message.
    func testADiskFailureIsReportedToTheCaller() throws {
        try Data().write(to: root) // a file where the queue directory should be
        let queue = OfflineReportQueue(root: root)
        queue.activate(ownerId: alice)

        XCTAssertThrowsError(try queue.enqueue(request, imageData: nil))
        XCTAssertTrue(queue.items.isEmpty)
    }

    func testAlertHistoryIsPartitionedByAccount() throws {
        let suite = "alerts-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = AlertsStore(defaults: defaults)

        store.activate(userId: alice)
        store.add(frame())
        store.deactivate()
        XCTAssertTrue(store.items.isEmpty)

        store.activate(userId: bob)
        XCTAssertTrue(store.items.isEmpty, "Bob must not see Alice's location-linked alerts")

        store.activate(userId: alice)
        XCTAssertEqual(store.items.count, 1)
    }

    func testTheAPIClientCanTellWhoATokenBelongsTo() {
        let payload = Data(#"{"sub":"\#(alice.uuidString)","exp":9999999999}"#.utf8).base64EncodedString()
            .replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        XCTAssertEqual(JWT.subject("header.\(payload).signature"), alice)
        XCTAssertEqual(APIEndpoint.me.acting(as: bob).actingUserId, bob)
    }

    private func frame() -> HazardEventFrame {
        HazardEventFrame(type: "hazard_created", change: "CREATED", hazardId: UUID(), hazardType: .openManhole,
                         latitude: 14.55, longitude: 121.02, status: .reported, severity: .high,
                         confirmationCount: 0, disputeCount: 0, distanceMeters: 40, alert: true, onRoute: false,
                         distanceAheadMeters: nil, occurredAt: Date(), version: 0)
    }
}
