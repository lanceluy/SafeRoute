package com.saferoute.backend.hazard;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class ExpiryPolicyTest {

    private final ExpiryPolicy policy = new ExpiryPolicy();

    @Test
    void temporaryHazardsExpireSoonerThanStructuralOnes() {
        assertThat(policy.ttlFor(HazardType.FLOODING)).isEqualTo(Duration.ofHours(12));
        assertThat(policy.ttlFor(HazardType.OPEN_MANHOLE)).isEqualTo(Duration.ofDays(7));
        assertThat(policy.ttlFor(HazardType.POOR_LIGHTING)).isEqualTo(Duration.ofDays(30));
        assertThat(policy.ttlFor(HazardType.FLOODING)).isLessThan(policy.ttlFor(HazardType.BROKEN_SIDEWALK));
    }

    @Test
    void expiringSoonIsTheLastFifthOfTheWindow() {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        // Flooding: 12h window, last fifth = 2h24m.
        assertThat(policy.isExpiringSoon(HazardType.FLOODING, now.plus(Duration.ofHours(3)), now)).isFalse();
        assertThat(policy.isExpiringSoon(HazardType.FLOODING, now.plus(Duration.ofHours(2)), now)).isTrue();
        assertThat(policy.isExpiringSoon(HazardType.FLOODING, now.minusSeconds(1), now)).isFalse();
    }
}
