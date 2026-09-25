import XCTest
import MapKit
@testable import SafeRoute

/// Following a walking user moves the map constantly; only leaving the loaded area may refetch.
final class LoadedBoxTests: XCTestCase {
    private let active: Set<HazardStatus> = [.reported, .verified, .disputed]
    private lazy var loaded = MapViewModel.LoadedBox(
        minLat: Fixtures.origin.latitude - 0.01, minLon: Fixtures.origin.longitude - 0.01,
        maxLat: Fixtures.origin.latitude + 0.01, maxLon: Fixtures.origin.longitude + 0.01,
        statuses: active)

    private func region(north: Double, east: Double, meters: Double = 500) -> MKCoordinateRegion {
        MKCoordinateRegion(center: Fixtures.point(north: north, east: east),
                           latitudinalMeters: meters, longitudinalMeters: meters)
    }

    func testASmallMoveInsideTheLoadedAreaNeedsNoFetch() {
        XCTAssertTrue(loaded.covers(region(north: 100, east: 50), statuses: active))
    }

    func testWalkingPastTheEdgeNeedsAFetch() {
        // The box reaches ~1.1 km north of the origin; a 500 m view centered 1 km north doesn't fit.
        XCTAssertFalse(loaded.covers(region(north: 1000, east: 0), statuses: active))
    }

    func testZoomingOutPastTheBoxNeedsAFetch() {
        XCTAssertFalse(loaded.covers(region(north: 0, east: 0, meters: 3000), statuses: active))
    }

    func testDifferentStatusFiltersNeedAFetch() {
        XCTAssertFalse(loaded.covers(region(north: 0, east: 0), statuses: [.resolved]))
    }
}
