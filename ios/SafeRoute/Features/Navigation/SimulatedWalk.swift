import Foundation
import CoreLocation

/// Development aid for the iOS Simulator: while navigating, the route is written to
/// `Documents/simulated-walk.json`, which `ios/scripts/simulate-walks.sh` (running on the Mac)
/// watches to walk the Simulator's GPS along it with `xcrun simctl location start`. An app can't
/// move the Simulator's location itself. Does nothing on a real iPhone or in release builds.
enum SimulatedWalk {
    static let fileName = "simulated-walk.json"

    /// Navigation started (or rerouted): walk from here along the route.
    static func started(from here: CLLocationCoordinate2D?, route: [CLLocationCoordinate2D]) {
        #if DEBUG && targetEnvironment(simulator)
        write(state: "walking", points: (here.map { [$0] } ?? []) + route)
        #endif
    }

    /// Navigation ended: stand still where the user is now.
    static func ended(at here: CLLocationCoordinate2D?) {
        #if DEBUG && targetEnvironment(simulator)
        write(state: "stopped", points: here.map { [$0] } ?? [])
        #endif
    }

    #if DEBUG && targetEnvironment(simulator)
    private struct Payload: Encodable {
        /// Changes on every write so the watcher notices a new walk even along the same route.
        let id = UUID()
        let state: String
        let points: [[Double]]
    }

    private static func write(state: String, points: [CLLocationCoordinate2D]) {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
              let data = try? JSONEncoder().encode(Payload(state: state, points: points.map { [$0.latitude, $0.longitude] }))
        else { return }
        try? data.write(to: documents.appendingPathComponent(fileName), options: .atomic)
    }
    #endif
}
