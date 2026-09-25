import XCTest
import CoreLocation
@testable import SafeRoute

@MainActor
final class NavigationSessionTests: XCTestCase {

    private let route = [Fixtures.point(north: 0, east: 0), Fixtures.point(north: 0, east: 800)]

    // F17: guidance knows every hazard the route assessment found, even if the map never loaded it.
    func testAHazardFoundByPlanningIsInGuidanceFromTheStart() {
        let farAhead = Fixtures.hazard(at: Fixtures.point(north: 5, east: 700))
        let (plan, option) = Fixtures.plan(route: route, assessedHazards: [farAhead])

        let session = NavigationSession(plan: plan, option: option, knownHazards: [], corridorMeters: 40)

        XCTAssertEqual(session.routeHazards.map(\.id), [farAhead.id])
    }

    func testASmallerViewportCacheDoesNotDropRouteHazards() {
        let farAhead = Fixtures.hazard(at: Fixtures.point(north: 5, east: 700))
        let (plan, option) = Fixtures.plan(route: route, assessedHazards: [farAhead])
        let session = NavigationSession(plan: plan, option: option, knownHazards: [], corridorMeters: 40)

        session.refreshHazards([]) // the map's viewport currently holds nothing

        XCTAssertEqual(session.routeHazards.map(\.id), [farAhead.id])
    }

    func testAnOlderSnapshotCannotResurrectAResolvedHazard() {
        let id = UUID()
        let resolved = Fixtures.hazard(at: Fixtures.point(north: 0, east: 300), status: .resolved, version: 4, id: id)
        let staleActive = Fixtures.hazard(at: Fixtures.point(north: 0, east: 300), status: .reported, version: 1, id: id)
        let (plan, option) = Fixtures.plan(route: route, assessedHazards: [resolved])
        let session = NavigationSession(plan: plan, option: option, knownHazards: [], corridorMeters: 40)

        session.refreshHazards([staleActive])

        XCTAssertTrue(session.routeHazards.isEmpty)
    }

    func testACompleteReassessmentRemovesHazardsResolvedWhileDisconnected() {
        let gone = Fixtures.hazard(at: Fixtures.point(north: 0, east: 300))
        let (plan, option) = Fixtures.plan(route: route, assessedHazards: [gone])
        let session = NavigationSession(plan: plan, option: option, knownHazards: [], corridorMeters: 40)

        session.replaceHazards(withCompleteAssessment: [])

        XCTAssertTrue(session.routeHazards.isEmpty)
    }

    // 7.3: inaccurate or stale fixes are ignored instead of moving the walker.
    func testInaccurateAndStaleFixesAreIgnored() {
        let (plan, option) = Fixtures.plan(route: route)
        let session = NavigationSession(plan: plan, option: option, knownHazards: [], corridorMeters: 40)
        let before = session.remainingDistance
        let farAlong = Fixtures.point(north: 0, east: 500)

        session.update(fix: fix(at: farAlong, accuracy: 120))
        session.update(fix: fix(at: farAlong, accuracy: 5, age: 60))

        XCTAssertEqual(session.remainingDistance, before, accuracy: 0.5)
    }

    // 7.3: on a route that doubles back, a fix near a later part of the route can't teleport progress.
    func testProgressCannotJumpToALaterNearbyPartOfTheRoute() {
        let uTurn = [Fixtures.point(north: 0, east: 0), Fixtures.point(north: 0, east: 300),
                     Fixtures.point(north: 60, east: 300), Fixtures.point(north: 60, east: 0)]
        let (plan, option) = Fixtures.plan(route: uTurn)
        let session = NavigationSession(plan: plan, option: option, knownHazards: [], corridorMeters: 40)
        session.update(fix: fix(at: Fixtures.point(north: 0, east: 20), accuracy: 5))
        let afterFirst = session.remainingDistance

        // Two seconds later, a noisy fix lands next to the return leg (~640 m along the route).
        session.update(fix: fix(at: Fixtures.point(north: 55, east: 20), accuracy: 5, age: 0, after: 2))

        XCTAssertGreaterThan(session.remainingDistance, afterFirst - 60, "progress jumped ahead")
    }

    private var clock = Date()

    private func fix(at coordinate: CLLocationCoordinate2D, accuracy: Double, age: TimeInterval = 0,
                     after seconds: TimeInterval = 0) -> CLLocation {
        clock = clock.addingTimeInterval(seconds)
        return CLLocation(coordinate: coordinate, altitude: 0, horizontalAccuracy: accuracy, verticalAccuracy: 10,
                          timestamp: clock.addingTimeInterval(-age))
    }
}
