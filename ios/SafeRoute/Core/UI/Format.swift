import Foundation
import CoreLocation

/// Human-readable data everywhere: "Just now", "4 min ago", "220 m ahead".
enum Format {
    static func distance(_ meters: Double) -> String {
        if meters < 1000 { return "\(Int((meters / 10).rounded() * 10)) m" }
        return String(format: "%.1f km", meters / 1000)
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let minutes = Int((seconds / 60).rounded())
        if minutes < 60 { return "\(max(1, minutes)) min" }
        return "\(minutes / 60) h \(minutes % 60) min"
    }

    /// Just now · 4 min ago · 2h ago · Yesterday · Sep 22
    static func relative(_ date: Date, now: Date = Date()) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 { return "Just now" }
        if seconds < 3600 { return "\(Int(seconds / 60)) min ago" }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) || seconds < 6 * 3600 { return "\(Int(seconds / 3600))h ago" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        let sameYear = calendar.isDate(date, equalTo: now, toGranularity: .year)
        return date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
    }

    /// For use mid-sentence ("Reported just now", "Reported Sep 22"): only lowercases words.
    static func relativeInSentence(_ date: Date, now: Date = Date()) -> String {
        let text = relative(date, now: now)
        return text == "Just now" || text == "Yesterday" ? text.lowercased() : text
    }

    /// For timelines: 11:04 PM · Yesterday, 11:04 PM · Sep 22, 11:04 PM
    static func timestamp(_ date: Date) -> String {
        let time = date.formatted(date: .omitted, time: .shortened)
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return time }
        if calendar.isDateInYesterday(date) { return "Yesterday, \(time)" }
        return "\(date.formatted(.dateTime.month(.abbreviated).day())), \(time)"
    }

    /// How long something stays: "less than an hour", "5 more hours", "3 more days".
    static func remaining(until date: Date, now: Date = Date()) -> String {
        let seconds = date.timeIntervalSince(now)
        if seconds < 3600 { return "less than an hour" }
        if seconds < 86_400 { let h = Int(seconds / 3600); return "\(h) more hour\(h == 1 ? "" : "s")" }
        let d = Int(seconds / 86_400)
        return "\(d) more day\(d == 1 ? "" : "s")"
    }

    /// "6 people confirmed this" / "Not confirmed yet"
    static func confirmations(_ count: Int) -> String {
        switch count {
        case 0: return "Not confirmed yet"
        case 1: return "1 person confirmed this"
        default: return "\(count) people confirmed this"
        }
    }

    static func distance(from a: CLLocationCoordinate2D?, to b: CLLocationCoordinate2D) -> Double? {
        guard let a else { return nil }
        return CLLocation(latitude: a.latitude, longitude: a.longitude)
            .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
    }

    static func greeting(for date: Date = Date()) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<12: return "Good morning"
        case 12..<18: return "Good afternoon"
        default: return "Good evening"
        }
    }
}
