import XCTest
import CoreLocation
@testable import SafeRoute

/// The background-alert endpoints must match the backend's /api/me/push-device routes.
final class PushEndpointTests: XCTestCase {
    private let token = String(repeating: "ab", count: 32)

    func testRegisterSendsTheTokenInTheBody() throws {
        let endpoint = APIEndpoint.registerPushDevice(token: token)
        XCTAssertEqual(endpoint.path, "/me/push-device")
        XCTAssertEqual(endpoint.method, "PUT")
        XCTAssertTrue(endpoint.requiresAuth)
        let body = try XCTUnwrap(endpoint.body)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: body) as? [String: String], ["deviceToken": token])
    }

    func testUnregisterDeletesByToken() {
        let endpoint = APIEndpoint.unregisterPushDevice(token: token)
        XCTAssertEqual(endpoint.path, "/me/push-device/\(token)")
        XCTAssertEqual(endpoint.method, "DELETE")
        XCTAssertNil(endpoint.body)
    }

    func testLocationUpdateSendsLatitudeAndLongitude() throws {
        let endpoint = APIEndpoint.updatePushDeviceLocation(token: token, Fixtures.origin)
        XCTAssertEqual(endpoint.path, "/me/push-device/\(token)/location")
        XCTAssertEqual(endpoint.method, "PUT")
        let body = try XCTUnwrap(endpoint.body)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: body) as? [String: Double])
        XCTAssertEqual(json["latitude"] ?? 0, Fixtures.origin.latitude, accuracy: 1e-9)
        XCTAssertEqual(json["longitude"] ?? 0, Fixtures.origin.longitude, accuracy: 1e-9)
    }

    func testExplicitBearerTokenOverridesTheKeychain() {
        let endpoint = APIEndpoint.unregisterPushDevice(token: token).authorized(with: "signed-out-access-token")
        XCTAssertEqual(endpoint.bearerToken, "signed-out-access-token")
        XCTAssertNil(APIEndpoint.unregisterPushDevice(token: token).bearerToken)
    }
}
