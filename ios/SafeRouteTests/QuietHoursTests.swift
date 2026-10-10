import XCTest
@testable import SafeRoute

/// Quiet hours ride along in the notification preferences; they must match the backend's `quietHours` object.
final class QuietHoursTests: XCTestCase {
    func testPreferencesWithoutQuietHoursOmitTheKeySoTheServerLeavesThemAlone() throws {
        let data = try JSONEncoder().encode(NotificationPreferences.default)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertNil(json["quietHours"])
    }

    func testQuietHoursAreSentWithTheBackendFieldNames() throws {
        var prefs = NotificationPreferences.default
        prefs.quietHours = QuietHours(enabled: true, startMinute: 1320, endMinute: 420, zone: "Asia/Manila")
        let data = try JSONEncoder().encode(prefs)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let quiet = try XCTUnwrap(json["quietHours"] as? [String: Any])
        XCTAssertEqual(quiet["enabled"] as? Bool, true)
        XCTAssertEqual(quiet["startMinute"] as? Int, 1320)
        XCTAssertEqual(quiet["endMinute"] as? Int, 420)
        XCTAssertEqual(quiet["zone"] as? String, "Asia/Manila")
    }

    func testDecodesServerResponseWithAndWithoutQuietHours() throws {
        let with = Data("""
        {"radiusMeters":400,"enabledTypes":["FLOODING"],"reportUpdates":true,
         "quietHours":{"enabled":true,"startMinute":60,"endMinute":120,"zone":"Asia/Manila"}}
        """.utf8)
        XCTAssertEqual(try JSONDecoder().decode(NotificationPreferences.self, from: with).quietHours?.startMinute, 60)

        let older = Data(#"{"radiusMeters":400,"enabledTypes":["FLOODING"]}"#.utf8)
        XCTAssertNil(try JSONDecoder().decode(NotificationPreferences.self, from: older).quietHours)
    }

    func testMinutesRoundTripThroughDatePickerDates() {
        for minute in [0, 59, 60, 420, 1320, 1439] {
            XCTAssertEqual(QuietHours.minute(of: QuietHours.date(for: minute)), minute)
        }
    }

    func testOvernightDefaultIsOffUntilTheUserTurnsItOn() {
        XCTAssertFalse(QuietHours.overnight.enabled)
        XCTAssertEqual(QuietHours.overnight.startMinute, 1320)
        XCTAssertEqual(QuietHours.overnight.endMinute, 420)
    }
}
