import Foundation
import UserNotifications

/// Posts an immediate local notification when an alert-worthy frame arrives over the WebSocket
/// (app open, or navigating in the background). Alerts while the app is closed come from APNs
/// instead; see PushRegistration.
@MainActor
final class NotificationManager {
    static let shared = NotificationManager()

    private init() {}

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func postHazardAlert(frame: HazardEventFrame) {
        let content = UNMutableNotificationContent()
        content.title = frame.alertTitle
        content.body = "\(frame.alertSubtitle). \(frame.severity.label)."
        content.sound = .default
        content.userInfo = ["hazardId": frame.hazardId.uuidString]

        let request = UNNotificationRequest(identifier: frame.id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
