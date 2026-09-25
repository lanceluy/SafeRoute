import XCTest
import CoreLocation
@testable import SafeRoute

/// F16 / F19: the map cache converges on the server's state and never goes back in time.
@MainActor
final class MapStateTests: XCTestCase {

    private let spot = Fixtures.point(north: 0, east: 0)
    private lazy var box = (minLat: spot.latitude - 0.01, minLon: spot.longitude - 0.01,
                            maxLat: spot.latitude + 0.01, maxLon: spot.longitude + 0.01)
    private let active: Set<HazardStatus> = [.reported, .verified, .disputed]

    func testAnOlderCreationFrameCannotOverwriteANewerResolvedState() {
        let model = MapViewModel()
        let id = UUID()
        model.upsert(Fixtures.hazard(at: spot, status: .resolved, version: 4, id: id))

        model.apply(frame(id: id, status: .reported, version: 1))

        XCTAssertEqual(model.hazards[id]?.status, .resolved)
    }

    func testAnOlderRestSnapshotCannotOverwriteANewerOne() {
        let model = MapViewModel()
        let id = UUID()
        model.upsert(Fixtures.hazard(at: spot, status: .resolved, version: 4, id: id))

        model.upsert(Fixtures.hazard(at: spot, status: .reported, version: 2, id: id))

        XCTAssertEqual(model.hazards[id]?.status, .resolved)
    }

    func testACompleteSnapshotRemovesAHazardResolvedWhileDisconnected() {
        let model = MapViewModel()
        let gone = Fixtures.hazard(at: spot)
        model.upsert(gone)

        model.reconcile(snapshot: [], box: box, statuses: active, sequenceAtStart: model.liveSequence)

        XCTAssertNil(model.hazards[gone.id])
    }

    func testASnapshotCannotRemoveAHazardThatChangedLiveWhileItWasInFlight() {
        let model = MapViewModel()
        let sequenceAtStart = model.liveSequence
        let id = UUID()
        model.apply(frame(id: id, status: .reported, version: 0)) // arrived after the query started

        model.reconcile(snapshot: [], box: box, statuses: active, sequenceAtStart: sequenceAtStart)

        XCTAssertNotNil(model.hazards[id])
    }

    func testASnapshotOnlySpeaksForItsOwnBox() {
        let model = MapViewModel()
        let elsewhere = Fixtures.hazard(at: Fixtures.point(north: 5000, east: 0))
        model.upsert(elsewhere)

        model.reconcile(snapshot: [], box: box, statuses: active, sequenceAtStart: model.liveSequence)

        XCTAssertNotNil(model.hazards[elsewhere.id])
    }

    private func frame(id: UUID, status: HazardStatus, version: Int64) -> HazardEventFrame {
        HazardEventFrame(type: "hazard_updated", change: "CREATED", hazardId: id, hazardType: .openManhole,
                         latitude: spot.latitude, longitude: spot.longitude, status: status, severity: .high,
                         confirmationCount: 0, disputeCount: 0, distanceMeters: 10, alert: false, onRoute: false,
                         distanceAheadMeters: nil, occurredAt: Date(), version: version)
    }
}
