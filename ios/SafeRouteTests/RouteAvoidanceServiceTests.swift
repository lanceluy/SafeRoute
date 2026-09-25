import XCTest
import CoreLocation
@testable import SafeRoute

/// Route assessment with injected directions and hazard sources, so no test depends on live
/// MapKit or the backend.
@MainActor
final class RouteAvoidanceServiceTests: XCTestCase {

    private let start = Fixtures.point(north: 0, east: 0)
    private let end = Fixtures.point(north: 0, east: 800)
    private lazy var straight = [start, end]
    /// Goes 120 m north, east, and back down: avoids anything on the straight line.
    private lazy var around = [start, Fixtures.point(north: 120, east: 0), Fixtures.point(north: 120, east: 800), end]
    private lazy var onPath = Fixtures.hazard(at: Fixtures.point(north: 0, east: 400))

    private func service(routes: [[CLLocationCoordinate2D]],
                         detour: @escaping (CLLocationCoordinate2D, RouteEndpoint) -> [CLLocationCoordinate2D]? = { _, _ in nil },
                         hazards: @escaping @MainActor ([[CLLocationCoordinate2D]]) throws -> RouteHazardsResponse) -> RouteAvoidanceService {
        RouteAvoidanceService(
            directions: { source, destination, alternates in
                if alternates { return routes.map { Fixtures.leg($0) } }
                return detour(source, destination).map { [Fixtures.leg($0)] } ?? []
            },
            hazardSource: { routes, _ in try hazards(routes) })
    }

    // F01: a failed hazard query must not look like a checked, clear route.
    func testHazardQueryFailureIsReportedAsUnavailableNotClear() async throws {
        let planner = service(routes: [straight]) { _ in throw TestFailure() }

        let plan = try await planner.plan(from: start, to: end, destinationName: "Office")

        guard case .unavailable = plan.assessment else { return XCTFail("expected .unavailable, got \(plan.assessment)") }
        XCTAssertNil(plan.safer)
        XCTAssertNotNil(plan.assessment.notice)
    }

    func testASuccessfulEmptyAnswerIsDistinguishableFromAnError() async throws {
        let planner = service(routes: [straight]) { _ in Fixtures.response([]) }

        let plan = try await planner.plan(from: start, to: end, destinationName: "Office")

        XCTAssertEqual(plan.assessment, .complete)
        XCTAssertTrue(plan.original.hazards.isEmpty)
    }

    // F02: an incomplete assessment still lists what it found, but makes no safer-route claim.
    func testIncompleteAssessmentSuppressesTheSaferRouteClaim() async throws {
        let hazard = onPath
        let planner = service(routes: [straight, around]) { _ in Fixtures.response([hazard], complete: false, truncated: true) }

        let plan = try await planner.plan(from: start, to: end, destinationName: "Office")

        guard case .incomplete = plan.assessment else { return XCTFail("expected .incomplete") }
        XCTAssertNil(plan.safer, "an alternate avoiding the known hazard must not be sold as safer on incomplete data")
        XCTAssertEqual(plan.original.hazards.map(\.id), [hazard.id])
    }

    func testALowerRiskMapKitAlternateIsPreferred() async throws {
        let hazard = onPath
        let planner = service(routes: [straight, around]) { _ in Fixtures.response([hazard]) }

        let plan = try await planner.plan(from: start, to: end, destinationName: "Office")

        XCTAssertEqual(plan.original.hazards.count, 1)
        XCTAssertEqual(plan.safer?.hazards.count, 0)
        XCTAssertEqual(plan.avoided.map(\.id), [hazard.id])
    }

    // F18: detour geometry is assessed with its own query, not scored against the original dataset.
    func testDetoursAreScoredAgainstTheirOwnAssessment() async throws {
        let hazard = onPath
        let detourHazard = Fixtures.hazard(at: Fixtures.point(north: 60, east: 400), severity: .high)
        var queries = 0
        let planner = service(
            routes: [straight],
            detour: { source, destination in
                if case .coordinate(let waypoint) = destination { return [source, waypoint] }
                return [source, self.end]
            },
            hazards: { _ in
                queries += 1
                // First query (original route) knows only the on-path hazard; the second (detours)
                // reveals a hazard the first query never covered.
                return queries == 1 ? Fixtures.response([hazard]) : Fixtures.response([detourHazard])
            })

        let plan = try await planner.plan(from: start, to: end, destinationName: "Office")

        XCTAssertEqual(queries, 2, "detour geometry must be assessed separately")
        XCTAssertTrue(plan.assessedHazards.contains { $0.id == detourHazard.id })
    }

    func testADetourWhoseAssessmentFailsIsNotProposed() async throws {
        let hazard = onPath
        var queries = 0
        let planner = service(
            routes: [straight],
            detour: { source, destination in
                if case .coordinate(let waypoint) = destination { return [source, waypoint] }
                return [source, self.end]
            },
            hazards: { _ in
                queries += 1
                if queries == 1 { return Fixtures.response([hazard]) }
                throw TestFailure()
            })

        let plan = try await planner.plan(from: start, to: end, destinationName: "Office")

        XCTAssertNil(plan.safer)
        XCTAssertEqual(plan.assessment, .complete, "the original route's own assessment is still valid")
    }

    func testLowSeverityHazardsDoNotTriggerStreetDetours() async throws {
        let dimLight = Fixtures.hazard(at: Fixtures.point(north: 0, east: 400), type: .poorLighting, severity: .low)
        var detourRequests = 0
        let planner = service(routes: [straight], detour: { _, _ in detourRequests += 1; return nil }) { _ in
            Fixtures.response([dimLight])
        }

        _ = try await planner.plan(from: start, to: end, destinationName: "Office")

        XCTAssertEqual(detourRequests, 0)
    }
}
