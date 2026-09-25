package com.saferoute.backend.hazard;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class HazardLifecycleTest {

    private final HazardLifecycle lifecycle = new HazardLifecycle(2, 2);

    @Test
    void reportedBecomesVerifiedAtThreshold() {
        assertThat(lifecycle.evaluate(HazardStatus.REPORTED, 1, 0)).isEqualTo(HazardStatus.REPORTED);
        assertThat(lifecycle.evaluate(HazardStatus.REPORTED, 2, 0)).isEqualTo(HazardStatus.VERIFIED);
    }

    @Test
    void disagreementIsSurfacedNotHidden() {
        assertThat(lifecycle.evaluate(HazardStatus.VERIFIED, 6, 1)).isEqualTo(HazardStatus.VERIFIED);
        assertThat(lifecycle.evaluate(HazardStatus.VERIFIED, 3, 4)).isEqualTo(HazardStatus.DISPUTED);
        assertThat(lifecycle.evaluate(HazardStatus.REPORTED, 2, 2)).isEqualTo(HazardStatus.DISPUTED);
    }

    @Test
    void singleDisputeDoesNotFlipAReport() {
        assertThat(lifecycle.evaluate(HazardStatus.REPORTED, 0, 1)).isEqualTo(HazardStatus.REPORTED);
    }

    @Test
    void disputedRecoversWhenConfirmationsOvertake() {
        assertThat(lifecycle.evaluate(HazardStatus.DISPUTED, 5, 2)).isEqualTo(HazardStatus.VERIFIED);
        assertThat(lifecycle.evaluate(HazardStatus.DISPUTED, 1, 0)).isEqualTo(HazardStatus.REPORTED);
    }

    @Test
    void terminalStatusesAreNotRecomputed() {
        assertThat(lifecycle.evaluate(HazardStatus.RESOLVED, 9, 0)).isEqualTo(HazardStatus.RESOLVED);
        assertThat(lifecycle.evaluate(HazardStatus.EXPIRED, 0, 9)).isEqualTo(HazardStatus.EXPIRED);
        assertThat(lifecycle.evaluate(HazardStatus.REMOVED, 3, 0)).isEqualTo(HazardStatus.REMOVED);
    }

    @Test
    void confidenceLevels() {
        assertThat(HazardLifecycle.confidence(HazardStatus.REPORTED, 0, 0)).isEqualTo(Confidence.UNCONFIRMED);
        assertThat(HazardLifecycle.confidence(HazardStatus.REPORTED, 1, 0)).isEqualTo(Confidence.LOW);
        assertThat(HazardLifecycle.confidence(HazardStatus.VERIFIED, 2, 0)).isEqualTo(Confidence.MEDIUM);
        assertThat(HazardLifecycle.confidence(HazardStatus.VERIFIED, 6, 1)).isEqualTo(Confidence.HIGH);
        assertThat(HazardLifecycle.confidence(HazardStatus.VERIFIED, 8, 1)).isEqualTo(Confidence.HIGH);
        assertThat(HazardLifecycle.confidence(HazardStatus.VERIFIED, 3, 2)).isEqualTo(Confidence.MEDIUM);
        assertThat(HazardLifecycle.confidence(HazardStatus.DISPUTED, 3, 4)).isEqualTo(Confidence.CONTESTED);
        assertThat(HazardLifecycle.confidence(HazardStatus.RESOLVED, 3, 0)).isNull();
    }
}
