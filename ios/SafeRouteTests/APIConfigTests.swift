import XCTest
@testable import SafeRoute

/// What people type into the login screen's Server field on a real iPhone.
final class APIConfigTests: XCTestCase {
    func testABareLanAddressGetsHttpAndTheBackendPort() {
        XCTAssertEqual(APIConfig.normalized("192.168.1.20")?.absoluteString, "http://192.168.1.20:8080")
        XCTAssertEqual(APIConfig.normalized(" my-mac.local ")?.absoluteString, "http://my-mac.local:8080")
    }

    func testAnExplicitPortOrHttpsIsKept() {
        XCTAssertEqual(APIConfig.normalized("my-mac.local:9090")?.absoluteString, "http://my-mac.local:9090")
        XCTAssertEqual(APIConfig.normalized("https://abc.ngrok.app/")?.absoluteString, "https://abc.ngrok.app")
    }

    func testPathsAreDroppedSoApiIsNotDoubled() {
        XCTAssertEqual(APIConfig.normalized("http://my-mac.local:8080/api")?.absoluteString, "http://my-mac.local:8080")
    }

    func testNonsenseIsRejected() {
        XCTAssertNil(APIConfig.normalized(""))
        XCTAssertNil(APIConfig.normalized("ftp://my-mac.local"))
        XCTAssertNil(APIConfig.normalized("http://"))
    }

    func testTheSimulatorAlwaysUsesLocalhost() {
        XCTAssertEqual(APIConfig.baseURL.absoluteString, "http://localhost:8080")
        XCTAssertEqual(APIConfig.webSocketURL.absoluteString, "ws://localhost:8080/ws/notifications")
        XCTAssertEqual(APIConfig.restBaseURL.absoluteString, "http://localhost:8080/api")
    }
}
