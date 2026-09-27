import XCTest
@testable import SafeRoute

final class ServerFrameTests: XCTestCase {

    func testReportUpdateFrameDecodes() throws {
        let json = """
        {"type":"report_update","hazardId":"3727d7bf-61bf-4708-8548-c381bc608d02","hazardType":"OPEN_MANHOLE",
         "change":"MUNICIPAL_RESPONSE","status":"REPORTED","assignedDepartment":"ENGINEERING",
         "title":"The city is on it","body":"Makati City assigned your open manhole report to Engineering.",
         "occurredAt":"2026-09-27T12:00:00Z"}
        """
        guard case .reportUpdate(let frame)? = ServerFrame.decode(Data(json.utf8)) else {
            return XCTFail("Expected a report update")
        }
        XCTAssertEqual(frame.assignedDepartment, "ENGINEERING")
        XCTAssertEqual(frame.change, "MUNICIPAL_RESPONSE")
        XCTAssertEqual(frame.title, "The city is on it")
    }

    func testHazardFrameCarriesTheCityResponse() throws {
        let json = """
        {"type":"hazard_updated","change":"MUNICIPAL_RESPONSE","hazardId":"3727d7bf-61bf-4708-8548-c381bc608d02",
         "hazardType":"OPEN_MANHOLE","latitude":14.56,"longitude":121.01,"status":"REPORTED","severity":"HIGH",
         "confirmationCount":0,"disputeCount":0,"distanceMeters":0,"alert":false,"onRoute":false,"version":3,
         "assignedDepartment":"ENGINEERING","municipalPriority":"URGENT"}
        """
        guard case .hazard(let frame)? = ServerFrame.decode(Data(json.utf8)) else {
            return XCTFail("Expected a hazard frame")
        }
        XCTAssertEqual(frame.assignedDepartment, "ENGINEERING")
        XCTAssertEqual(MunicipalPriority(serverValue: frame.municipalPriority), .urgent)
    }

    func testUnknownPriorityDoesNotBreakAHazard() throws {
        let data = Data(#""CRITICAL""#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(MunicipalPriority.self, from: data), .normal)
    }
}
