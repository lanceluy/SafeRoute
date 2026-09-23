import Foundation
import CoreLocation

/// Street names for report rows ("Ayala Avenue"). CLGeocoder is rate-limited, so lookups are
/// serialized and cached.
@MainActor
final class PlaceNameCache: ObservableObject {
    static let shared = PlaceNameCache()

    @Published private(set) var names: [String: String] = [:]
    /// Neighbourhood names for the map greeting ("Stay aware around Poblacion").
    @Published private(set) var areas: [String: String] = [:]
    private let geocoder = CLGeocoder()
    private var queue: [CLLocationCoordinate2D] = []
    private var isRunning = false
    private var areasInFlight = Set<String>()

    func name(for coordinate: CLLocationCoordinate2D) -> String? {
        let key = Self.key(coordinate)
        if let name = names[key] { return name }
        if !queue.contains(where: { Self.key($0) == key }) {
            queue.append(coordinate)
            run()
        }
        return nil
    }

    func neighbourhood(for coordinate: CLLocationCoordinate2D) -> String? {
        let key = String(format: "%.3f,%.3f", coordinate.latitude, coordinate.longitude)
        if let area = areas[key] { return area.isEmpty ? nil : area }
        guard !areasInFlight.contains(key) else { return nil }
        areasInFlight.insert(key) // not @Published: safe to mutate during a view update
        Task {
            let placemark = try? await CLGeocoder().reverseGeocodeLocation(
                CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)).first
            areas[key] = placemark?.subLocality ?? placemark?.locality ?? ""
        }
        return nil
    }

    private func run() {
        guard !isRunning, !queue.isEmpty else { return }
        isRunning = true
        let next = queue.removeFirst()
        Task {
            let placemark = try? await geocoder.reverseGeocodeLocation(CLLocation(latitude: next.latitude, longitude: next.longitude)).first
            names[Self.key(next)] = placemark?.thoroughfare ?? placemark?.name ?? placemark?.locality ?? ""
            try? await Task.sleep(for: .milliseconds(300))
            isRunning = false
            run()
        }
    }

    private static func key(_ c: CLLocationCoordinate2D) -> String {
        String(format: "%.4f,%.4f", c.latitude, c.longitude)
    }
}
