package com.saferoute.backend.websocket;

import com.saferoute.backend.spatial.GeoUtils;

import java.util.List;

/**
 * A commuter's active route polyline, used to decide whether a hazard is <em>on their route and
 * ahead of them</em> rather than merely nearby. Distances use a local
 * equirectangular projection, which is accurate to well under a meter over walking distances.
 */
public final class RouteCorridor {

    public record Projection(double distanceFromRouteMeters, double distanceAlongRouteMeters) {
    }

    private static final double METERS_PER_DEGREE = 111_320.0;

    private final double[][] points; // [lat, lon]
    private final double[] cumulative;

    public RouteCorridor(List<double[]> latLonPoints) {
        if (latLonPoints == null || latLonPoints.size() < 2) {
            throw new IllegalArgumentException("A route needs at least two points");
        }
        this.points = latLonPoints.toArray(new double[0][]);
        this.cumulative = new double[points.length];
        for (int i = 1; i < points.length; i++) {
            cumulative[i] = cumulative[i - 1] + GeoUtils.distanceMeters(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
        }
    }

    public int size() {
        return points.length;
    }

    public double lengthMeters() {
        return cumulative[cumulative.length - 1];
    }

    public Projection project(double lat, double lon) {
        double best = Double.MAX_VALUE;
        double along = 0;
        double cosLat = Math.cos(Math.toRadians(lat));
        for (int i = 0; i < points.length - 1; i++) {
            // Local planar coordinates in meters, origin at the query point.
            double ax = (points[i][1] - lon) * METERS_PER_DEGREE * cosLat;
            double ay = (points[i][0] - lat) * METERS_PER_DEGREE;
            double bx = (points[i + 1][1] - lon) * METERS_PER_DEGREE * cosLat;
            double by = (points[i + 1][0] - lat) * METERS_PER_DEGREE;
            double dx = bx - ax, dy = by - ay;
            double lengthSq = dx * dx + dy * dy;
            double t = lengthSq == 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
            double px = ax + t * dx, py = ay + t * dy;
            double distance = Math.hypot(px, py);
            if (distance < best) {
                best = distance;
                along = cumulative[i] + t * Math.sqrt(lengthSq);
            }
        }
        return new Projection(best, along);
    }
}
