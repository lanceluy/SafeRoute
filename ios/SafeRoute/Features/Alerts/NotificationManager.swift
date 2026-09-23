import Foundation
import UserNotifications

/// Posts an immediate local notification when an alert-worthy frame arrives over the WebSocket.
/// This is the explicit substitute for real APNs push per project scope (APNs needs an Apple
/// Developer account/push certs, which this prototype doesn't require).
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
