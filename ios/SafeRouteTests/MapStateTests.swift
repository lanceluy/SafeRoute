import XCTest
import CoreLocation
import MapKit
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

/// The nearby count must not depend on how far the map is zoomed in.
final class QueryBoxTests: XCTestCase {
    private let user = CLLocationCoordinate2D(latitude: 14.56628, longitude: 121.01542)

    func testZoomedInMapStillLoadsTheNearbyRadius() {
        // Street level: about 400 m across.
        let region = MKCoordinateRegion(center: user, latitudinalMeters: 400, longitudinalMeters: 400)
        let box = MapViewModel.queryBox(for: region, user: user)
        let oneKmLat = 1000 / 111_320.0
        XCTAssertLessThanOrEqual(box.minLat, user.latitude - oneKmLat)
        XCTAssertGreaterThanOrEqual(box.maxLat, user.latitude + oneKmLat)
        XCTAssertLessThanOrEqual(box.minLon, user.longitude - oneKmLat)
        XCTAssertGreaterThanOrEqual(box.maxLon, user.longitude + oneKmLat)
    }

    func testBrowsingFarAwayKeepsJustTheVisibleRegion() {
        let elsewhere = CLLocationCoordinate2D(latitude: 14.40, longitude: 120.95)
        let region = MKCoordinateRegion(center: elsewhere, latitudinalMeters: 20_000, longitudinalMeters: 20_000)
        let farUser = CLLocationCoordinate2D(latitude: 14.79, longitude: 121.14)
        let box = MapViewModel.queryBox(for: region, user: farUser)
        XCTAssertLessThan(box.maxLat, 14.6)
    }

    func testWithoutALocationTheBoxIsThePaddedRegion() {
        let region = MKCoordinateRegion(center: user, latitudinalMeters: 400, longitudinalMeters: 400)
        let box = MapViewModel.queryBox(for: region, user: nil)
        XCTAssertEqual(box.maxLat - box.minLat, region.span.latitudeDelta * 1.2, accuracy: 1e-9)
    }
}

final class LoadedBoxNearbyTests: XCTestCase {
    func testASmallBoxDoesNotCoverTheNearbyRadius() {
        let user = CLLocationCoordinate2D(latitude: 14.56628, longitude: 121.01542)
        let small = MapViewModel.LoadedBox(minLat: 14.564, minLon: 121.013, maxLat: 14.568, maxLon: 121.018, statuses: [])
        XCTAssertFalse(small.coversNearby(user))
        let box = MapViewModel.queryBox(for: MKCoordinateRegion(center: user, latitudinalMeters: 400, longitudinalMeters: 400), user: user)
        let loaded = MapViewModel.LoadedBox(minLat: box.minLat, minLon: box.minLon, maxLat: box.maxLat, maxLon: box.maxLon, statuses: [])
        XCTAssertTrue(loaded.coversNearby(user))
    }
}
