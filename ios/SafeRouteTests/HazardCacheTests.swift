import XCTest
@testable import SafeRoute

/// Task 2, revision 1: hazards already known stay on the map when the app opens offline.
@MainActor
final class HazardCacheTests: XCTestCase {

    private var file: URL!
    private let owner = UUID()
    private let spot = Fixtures.point(north: 0, east: 0)

    override func setUp() {
        file = FileManager.default.temporaryDirectory.appendingPathComponent("HazardCache-\(UUID()).json")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: file)
    }

    func testSavedHazardsComeBackForTheSameAccountOnly() throws {
        let cache = HazardCache(file: file)
        let hazard = Fixtures.hazard(at: spot, status: .verified, version: 3, id: UUID())
        try cache.save([hazard], ownerId: owner)

        XCTAssertEqual(cache.load(ownerId: owner)?.hazards.map(\.id), [hazard.id])
        XCTAssertNil(cache.load(ownerId: UUID()), "another account never sees this one's cache")
    }

    func testClosedAndExpiredHazardsAreNotKept() throws {
        let cache = HazardCache(file: file)
        var expired = Fixtures.hazard(at: spot, status: .reported, version: 1, id: UUID())
        expired.expiresAt = Date().addingTimeInterval(-60)
        let resolved = Fixtures.hazard(at: spot, status: .resolved, version: 1, id: UUID())
        let live = Fixtures.hazard(at: spot, status: .reported, version: 1, id: UUID())
        try cache.save([expired, resolved, live], ownerId: owner)

        XCTAssertEqual(cache.load(ownerId: owner)?.hazards.map(\.id), [live.id])
    }

    func testTheMapOpensWithSavedHazardsAndSignOutClearsThem() throws {
        let cache = HazardCache(file: file)
        let hazard = Fixtures.hazard(at: spot, status: .verified, version: 2, id: UUID())
        try cache.save([hazard], ownerId: owner)

        let model = MapViewModel(cache: cache)
        model.restoreCached(for: owner)
        XCTAssertNotNil(model.hazards[hazard.id])
        XCTAssertNotNil(model.showingSavedSince)

        model.reset()
        XCTAssertNil(cache.load(ownerId: owner))
    }
}
