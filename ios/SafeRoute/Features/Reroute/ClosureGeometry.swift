import Foundation
import MapKit

/// Whether a walking route runs through a closed road. A closure is a line widened by its own
/// buffer, so a route that crosses it, or walks alongside within the buffer, is blocked.
enum ClosureGeometry {
    /// Shortest distance in meters between the closure's line and the route polyline; 0 if they cross.
    nonisolated static func distance(from closure: RoadClosure, to polyline: MKPolyline) -> Double {
        let line = closure.path.map { MKMapPoint($0) }
        guard line.count > 1, polyline.pointCount > 1 else { return .greatestFiniteMagnitude }
        let route = polyline.points()
        var best = Double.greatestFiniteMagnitude
        for i in 0..<(line.count - 1) {
            for j in 0..<(polyline.pointCount - 1) {
                best = min(best, segmentDistance(line[i], line[i + 1], route[j], route[j + 1]))
                if best == 0 { return 0 }
            }
        }
        return best
    }

    nonisolated static func blocks(_ closure: RoadClosure, route polyline: MKPolyline) -> Bool {
        guard closure.isActive else { return false }
        // Cheap reject before the pairwise segment check.
        let lineRect = closure.path.reduce(MKMapRect.null) { rect, c in
            let p = MKMapPoint(c)
            return rect.union(MKMapRect(x: p.x, y: p.y, width: 0, height: 0))
        }
        let margin = Double(closure.bufferMeters) * MKMapPointsPerMeterAtLatitude(closure.path.first?.latitude ?? 0)
        if !lineRect.insetBy(dx: -margin, dy: -margin).intersects(polyline.boundingMapRect) { return false }
        return distance(from: closure, to: polyline) <= Double(closure.bufferMeters)
    }

    /// Distance in meters between segments [a, b] and [c, d] (0 when they intersect).
    nonisolated private static func segmentDistance(_ a: MKMapPoint, _ b: MKMapPoint, _ c: MKMapPoint, _ d: MKMapPoint) -> Double {
        if intersect(a, b, c, d) { return 0 }
        return min(a.distance(toSegmentFrom: c, to: d), b.distance(toSegmentFrom: c, to: d),
                   c.distance(toSegmentFrom: a, to: b), d.distance(toSegmentFrom: a, to: b))
    }

    nonisolated private static func intersect(_ a: MKMapPoint, _ b: MKMapPoint, _ c: MKMapPoint, _ d: MKMapPoint) -> Bool {
        func orient(_ p: MKMapPoint, _ q: MKMapPoint, _ r: MKMapPoint) -> Double {
            (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
        }
        let d1 = orient(a, b, c), d2 = orient(a, b, d), d3 = orient(c, d, a), d4 = orient(c, d, b)
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    }
}
