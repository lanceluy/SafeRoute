package com.saferoute.backend.user;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class QuietHoursTest {

    /** Manila is UTC+8 all year, so 14:30Z is 22:30 there. */
    private static final Instant MANILA_2230 = Instant.parse("2026-10-10T14:30:00Z");
    private static final Instant MANILA_0700 = Instant.parse("2026-10-09T23:00:00Z");
    private static final Instant MANILA_1200 = Instant.parse("2026-10-10T04:00:00Z");

    @Test
    void overnightWindowWrapsPastMidnight() {
        QuietHours night = new QuietHours(true, 22 * 60, 7 * 60, "Asia/Manila");
        assertThat(night.isQuietAt(MANILA_2230)).isTrue();
        assertThat(night.isQuietAt(Instant.parse("2026-10-10T18:00:00Z"))).isTrue();   // 02:00 next day
        assertThat(night.isQuietAt(MANILA_1200)).isFalse();
    }

    @Test
    void windowEndIsExclusiveAndStartIsInclusive() {
        QuietHours night = new QuietHours(true, 22 * 60, 7 * 60, "Asia/Manila");
        assertThat(night.isQuietAt(MANILA_0700)).isFalse();
        assertThat(night.isQuietAt(Instant.parse("2026-10-10T14:00:00Z"))).isTrue();   // exactly 22:00
    }

    @Test
    void sameDayWindow() {
        QuietHours lunch = new QuietHours(true, 11 * 60, 13 * 60, "Asia/Manila");
        assertThat(lunch.isQuietAt(MANILA_1200)).isTrue();
        assertThat(lunch.isQuietAt(MANILA_2230)).isFalse();
    }

    @Test
    void usesTheStoredZoneNotTheServers() {
        QuietHours utcNight = new QuietHours(true, 22 * 60, 7 * 60, "UTC");
        assertThat(utcNight.isQuietAt(MANILA_2230)).isFalse();                         // 14:30 UTC
        assertThat(utcNight.isQuietAt(Instant.parse("2026-10-10T23:00:00Z"))).isTrue();
    }

    @Test
    void disabledOrEmptyWindowIsNeverQuiet() {
        assertThat(new QuietHours(false, 22 * 60, 7 * 60, "Asia/Manila").isQuietAt(MANILA_2230)).isFalse();
        assertThat(new QuietHours(true, 600, 600, "Asia/Manila").isQuietAt(MANILA_2230)).isFalse();
        assertThat(QuietHours.OFF.isQuietAt(MANILA_2230)).isFalse();
    }

    @Test
    void blankZoneDefaultsToManilaAndUnknownZoneIsRejected() {
        assertThat(new QuietHours(true, 0, 60, " ").zone()).isEqualTo("Asia/Manila");
        assertThat(new QuietHours(true, 0, 60, null).zone()).isEqualTo("Asia/Manila");
        assertThatThrownBy(() -> new QuietHours(true, 0, 60, "Mars/Olympus"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
