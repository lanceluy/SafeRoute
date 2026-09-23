package com.saferoute.backend.websocket;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class RouteCorridorTest {

    // A straight ~1.1 km walk due north along longitude 121.0 in Manila.
    private final RouteCorridor route = new RouteCorridor(List.of(
            new double[]{14.5500, 121.0000},
            new double[]{14.5550, 121.0000},
            new double[]{14.5600, 121.0000}));

    @Test
    void pointOnTheRouteHasZeroOffsetAndCorrectDistanceAlong() {
        var p = route.project(14.5550, 121.0000);
        assertThat(p.distanceFromRouteMeters()).isCloseTo(0, within(0.5));
        assertThat(p.distanceAlongRouteMeters()).isCloseTo(556, within(3.0));
    }

    @Test
    void pointBesideTheRouteMeasuresPerpendicularDistance() {
        // 0.0003° of longitude at 14.55°N ≈ 32 m.
        var p = route.project(14.5575, 121.0003);
        assertThat(p.distanceFromRouteMeters()).isCloseTo(32.3, within(1.0));
    }

    @Test
    void hazardAheadVersusBehind() {
        var user = route.project(14.5550, 121.0000);
        var ahead = route.project(14.5580, 121.0001);
        var behind = route.project(14.5520, 121.0001);
        assertThat(ahead.distanceAlongRouteMeters()).isGreaterThan(user.distanceAlongRouteMeters());
        assertThat(behind.distanceAlongRouteMeters()).isLessThan(user.distanceAlongRouteMeters());
    }
}
