import Foundation
import CoreLocation
import MapKit
import Combine
import AVFoundation
import UIKit

/// Turn-by-turn walking guidance along a planned route, focused on hazards ahead.
/// Tracks progress by projecting each location fix onto the route polyline.
@MainActor
final class NavigationSession: ObservableObject {
    struct Step {
        let instruction: String
        let symbol: String
        /// Distance along the route where this manoeuvre happens.
        let atAlong: Double
    }

    struct HazardOnRoute: Identifiable, Equatable {
        let hazard: Hazard
        /// Distance along the route to the point nearest the hazard.
        let along: Double
        /// How far the hazard sits from the path.
        let offset: Double
        var id: UUID { hazard.id }
    }

    enum Phase: Equatable { case navigating, offRoute, arrived }

    let destinationName: String
    let destination: CLLocationCoordinate2D
    let option: RouteOption

    @Published private(set) var phase: Phase = .navigating
    @Published private(set) var remainingDistance: Double
    @Published private(set) var remainingTime: TimeInterval
    @Published private(set) var nextStep: Step?
    @Published private(set) var distanceToNextStep: Double = 0
    @Published private(set) var routeHazards: [HazardOnRoute] = []
    /// Hazards still ahead of the walker, nearest first, with distance ahead.
    @Published private(set) var hazardsAhead: [(hazard: HazardOnRoute, distance: Double)] = []
    @Published var voiceEnabled = true {
        didSet { if !voiceEnabled { speech.stopSpeaking(at: .immediate) } }
    }

    /// Within this distance the next hazard is shown as an active warning.
    static let warningDistance: Double = 150
    private static let offRouteMeters: Double = 45
    private static let arrivalMeters: Double = 25
    private static let arrivalNearEndMeters: Double = 100
    /// Fixes worse or older than this are ignored rather than trusted.
    static let maxFixAccuracyMeters: Double = 50
    static let maxFixAge: TimeInterval = 10
    /// Fast walking pace, used to bound how far along the route one fix may move the walker.
    private static let maxWalkingSpeed: Double = 3

    /// Same corridor as route assessment and the server's on-route alerts.
    private let corridorMeters: Double
    /// Whether the plan's hazard data was complete; guidance says so when it wasn't.
    let assessment: HazardAssessment
    /// Every hazard known along this route: seeded from the route assessment, then kept current
    /// from live updates. Never shrunk by a smaller viewport cache.
    private var knownHazards: [UUID: Hazard] = [:]
    private var lastFixTime: Date?

    private let path: RoutePath
    private let steps: [Step]
    private var userAlong: Double = 0
    private var offRouteStrikes = 0
    private var announced: [UUID: Int] = [:] // hazard id -> last threshold announced (150 / 40)
    private var subscription: AnyCancellable?
    private let speech = AVSpeechSynthesizer()
    private let haptics = UINotificationFeedbackGenerator()

    init(plan: RoutePlan, option: RouteOption, knownHazards: [Hazard],
         corridorMeters: Double = RoutingSettings.corridorMeters) {
        destinationName = plan.destinationName
        destination = plan.destination
        self.option = option
        self.corridorMeters = corridorMeters
        self.assessment = plan.assessment
        path = RoutePath(option.coordinates)
        remainingDistance = path.length
        remainingTime = option.expectedTravelTime
        steps = Self.buildSteps(option)
        #if DEBUG
        // Automated demo runs shouldn't talk through the Mac's speakers.
        if ProcessInfo.processInfo.environment["SAFEROUTE_DEMO_SKIP_PROMPTS"] != nil { voiceEnabled = false }
        #endif
        merge(plan.assessedHazards)
        refreshHazards(knownHazards)
    }

    var nextHazard: (hazard: HazardOnRoute, distance: Double)? { hazardsAhead.first }

    var activeWarning: (hazard: HazardOnRoute, distance: Double)? {
        guard let next = nextHazard, next.distance <= Self.warningDistance else { return nil }
        return next
    }

    var arrivalTime: Date { Date().addingTimeInterval(remainingTime) }

    // MARK: Lifecycle

    func start() {
        UIApplication.shared.isIdleTimerDisabled = true
        LocationManager.shared.setNavigationMode(true)
        subscription = LocationManager.shared.$currentFix
            .compactMap { $0 }
            .sink { [weak self] in self?.update(fix: $0) }
        let count = routeHazards.count
        let summary: String
        if !assessment.isComplete {
            summary = count == 0 ? "Hazard information for this route is incomplete. Take care."
                : "\(count) reported hazard\(count == 1 ? "" : "s") known on this route; hazard information is incomplete."
        } else {
            summary = count == 0 ? "No reported hazards on this route." : "\(count) reported hazard\(count == 1 ? "" : "s") on this route."
        }
        speak("Starting route to \(destinationName). " + summary)
    }

    func stop() {
        subscription = nil
        speech.stopSpeaking(at: .immediate)
        UIApplication.shared.isIdleTimerDisabled = false
        LocationManager.shared.setNavigationMode(false)
    }

    /// Picks up hazards reported, changed or resolved while walking. Merges by id, keeping the
    /// newest version: a hazard missing from `hazards` is kept, because the caller's list may be
    /// a smaller viewport cache rather than the route's full set.
    func refreshHazards(_ hazards: [Hazard]) {
        merge(hazards)
        routeHazards = knownHazards.values.compactMap { hazard -> HazardOnRoute? in
            guard hazard.status.isActive else { return nil }
            let p = path.project(hazard.coordinate)
            return p.offset <= corridorMeters ? HazardOnRoute(hazard: hazard, along: p.along, offset: p.offset) : nil
        }
        .sorted { $0.along < $1.along }
        updateProgress()
    }

    /// Replaces the route's hazard set with an authoritative, complete re-assessment (e.g. after
    /// reconnecting), so hazards resolved while we were disconnected disappear.
    func replaceHazards(withCompleteAssessment hazards: [Hazard]) {
        knownHazards = [:]
        refreshHazards(hazards)
    }

    private func merge(_ hazards: [Hazard]) {
        for hazard in hazards {
            if let existing = knownHazards[hazard.id], (existing.version ?? 0) > (hazard.version ?? 0) { continue }
            knownHazards[hazard.id] = hazard
        }
    }

    // MARK: Progress

    /// A real GPS fix: ignored if stale or too inaccurate to place the walker on the route.
    func update(fix: CLLocation, now: Date = Date()) {
        guard fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= Self.maxFixAccuracyMeters,
              now.timeIntervalSince(fix.timestamp) <= Self.maxFixAge else { return }
        let elapsed = lastFixTime.map { max(1, fix.timestamp.timeIntervalSince($0)) } ?? 10
        lastFixTime = fix.timestamp
        // One fix can't move the walker further along than they could plausibly have walked, so a
        // loop or a parallel street further along the route doesn't make progress jump ahead.
        let maxAdvance = max(30, elapsed * Self.maxWalkingSpeed + fix.horizontalAccuracy + 15)
        update(location: fix.coordinate, progressWindow: (userAlong - 40)...(userAlong + maxAdvance))
    }

    func update(location: CLLocationCoordinate2D, progressWindow: ClosedRange<Double>? = nil) {
        guard phase != .arrived else { return }
        let p = progressWindow.map { path.project(location, within: $0) } ?? path.project(location)
        // Avoid jumping backwards on noisy fixes where the route doubles back on itself.
        userAlong = p.along < userAlong - 40 ? userAlong : p.along

        if p.offset > Self.offRouteMeters {
            offRouteStrikes += 1
            if offRouteStrikes >= 3 && phase != .offRoute {
                phase = .offRoute
                haptics.notificationOccurred(.warning)
                speak("You're off the route.")
            }
        } else {
            offRouteStrikes = 0
            if phase == .offRoute { phase = .navigating }
        }

        let toDestination = CLLocation(latitude: location.latitude, longitude: location.longitude)
            .distance(from: CLLocation(latitude: destination.latitude, longitude: destination.longitude))
        // Being near the destination only counts near the end of the route: a route that loops back
        // past its own end must not "arrive" on the way out.
        let remainingAlong = path.length - userAlong
        if (toDestination <= Self.arrivalMeters && remainingAlong <= Self.arrivalNearEndMeters)
            || (remainingAlong <= Self.arrivalMeters && p.offset < Self.offRouteMeters) {
            phase = .arrived
            remainingDistance = 0
            remainingTime = 0
            hazardsAhead = []
            haptics.notificationOccurred(.success)
            speak("You have arrived at \(destinationName).")
            return
        }
        updateProgress()
        announceHazards()
    }

    private func updateProgress() {
        remainingDistance = max(0, path.length - userAlong)
        remainingTime = path.length > 0 ? option.expectedTravelTime * remainingDistance / path.length : 0
        hazardsAhead = routeHazards
            .map { ($0, $0.along - userAlong) }
            .filter { $0.1 >= -10 } // just passed still counts for a few meters
            .map { (hazard: $0.0, distance: max(0, $0.1)) }
        nextStep = steps.first { $0.atAlong > userAlong + 5 }
        distanceToNextStep = max(0, (nextStep?.atAlong ?? path.length) - userAlong)
    }

    private func announceHazards() {
        guard let (hazard, distance) = nextHazard else { return }
        let threshold = distance <= 40 ? 40 : distance <= Self.warningDistance ? 150 : nil
        guard let threshold, (announced[hazard.id] ?? Int.max) > threshold else { return }
        announced[hazard.id] = threshold
        haptics.notificationOccurred(hazard.hazard.severity == .high ? .error : .warning)
        let name = hazard.hazard.type.displayName.lowercased()
        speak(threshold == 40 ? "Caution. \(name) just ahead." : "Caution. \(name) in \(Int((distance / 10).rounded()) * 10) meters.")
    }

    private func speak(_ text: String) {
        guard voiceEnabled else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        speech.speak(utterance)
    }

    // MARK: Steps

    private static func buildSteps(_ option: RouteOption) -> [Step] {
        var result: [Step] = []
        var offset: Double = 0
        for (legIndex, leg) in option.legs.enumerated() {
            var along = offset
            let isLastLeg = legIndex == option.legs.count - 1
            for step in leg.steps {
                along += step.distance
                let text = step.instructions.trimmingCharacters(in: .whitespaces)
                guard !text.isEmpty else { continue }
                // The detour waypoint's own "arrive" step is meaningless to the walker.
                if !isLastLeg && text.localizedCaseInsensitiveContains("destination") { continue }
                result.append(Step(instruction: text, symbol: symbol(for: text), atAlong: along - step.distance))
            }
            offset += leg.distance
        }
        result.append(Step(instruction: "Arrive at your destination", symbol: "flag.checkered", atAlong: offset))
        return result
    }

    private static func symbol(for instruction: String) -> String {
        let text = instruction.lowercased()
        if text.contains("destination") || text.contains("arrive") { return "flag.checkered" }
        if text.contains("slight left") || text.contains("bear left") { return "arrow.up.left" }
        if text.contains("slight right") || text.contains("bear right") { return "arrow.up.right" }
        if text.contains("left") { return "arrow.turn.up.left" }
        if text.contains("right") { return "arrow.turn.up.right" }
        if text.contains("u-turn") || text.contains("turn around") { return "arrow.uturn.down" }
        return "arrow.up"
    }
}

/// A route polyline with cumulative distances, projected in a local planar approximation
/// (accurate to well under a meter over walking distances).
struct RoutePath {
    private let points: [CLLocationCoordinate2D]
    private let cumulative: [Double]

    init(_ points: [CLLocationCoordinate2D]) {
        self.points = points.filter { CLLocationCoordinate2DIsValid($0) }
        var total: Double = 0
        var cumulative = [0.0]
        for i in 1..<max(1, self.points.count) {
            let a = self.points[i - 1], b = self.points[i]
            total += CLLocation(latitude: a.latitude, longitude: a.longitude).distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
            cumulative.append(total)
        }
        self.cumulative = cumulative
    }

    var length: Double { cumulative.last ?? 0 }

    /// (distance along the route to the nearest point, perpendicular offset from the route)
    func project(_ c: CLLocationCoordinate2D) -> (along: Double, offset: Double) {
        project(c, within: nil)
    }

    /// Like `project`, but only considers route positions whose distance-along falls in `window`.
    func project(_ c: CLLocationCoordinate2D, within window: ClosedRange<Double>?) -> (along: Double, offset: Double) {
        guard points.count > 1 else { return (0, .greatestFiniteMagnitude) }
        let metersPerDegree = 111_320.0
        let cosLat = cos(c.latitude * .pi / 180)
        var best = (along: 0.0, offset: Double.greatestFiniteMagnitude)
        for i in 0..<(points.count - 1) {
            let ax = (points[i].longitude - c.longitude) * metersPerDegree * cosLat
            let ay = (points[i].latitude - c.latitude) * metersPerDegree
            let bx = (points[i + 1].longitude - c.longitude) * metersPerDegree * cosLat
            let by = (points[i + 1].latitude - c.latitude) * metersPerDegree
            let dx = bx - ax, dy = by - ay
            let lengthSq = dx * dx + dy * dy
            var t = lengthSq == 0 ? 0 : max(0, min(1, -(ax * dx + ay * dy) / lengthSq))
            let segStart = cumulative[i], segLength = cumulative[i + 1] - cumulative[i]
            if let window {
                // Skip segments entirely outside the window; clamp t to the part inside it.
                guard segStart + segLength >= window.lowerBound, segStart <= window.upperBound else { continue }
                if segLength > 0 {
                    let lo = max(0, (window.lowerBound - segStart) / segLength)
                    let hi = min(1, (window.upperBound - segStart) / segLength)
                    t = min(max(t, lo), hi)
                }
            }
            let offset = hypot(ax + t * dx, ay + t * dy)
            if offset < best.offset {
                best = (segStart + t * segLength, offset)
            }
        }
        return best
    }
}
