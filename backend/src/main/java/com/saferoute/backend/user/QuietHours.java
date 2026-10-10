package com.saferoute.backend.user;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/**
 * A daily window with no background push alerts. Minutes are since local midnight in {@code zone};
 * the window may wrap past midnight (22:00 to 07:00). A window whose start equals its end is empty.
 */
public record QuietHours(boolean enabled,
                         @Min(0) @Max(1439) int startMinute,
                         @Min(0) @Max(1439) int endMinute,
                         String zone) {

    public static final String DEFAULT_ZONE = "Asia/Manila";
    public static final QuietHours OFF = new QuietHours(false, 22 * 60, 7 * 60, DEFAULT_ZONE);

    public QuietHours {
        if (zone == null || zone.isBlank()) {
            zone = DEFAULT_ZONE;
        } else {
            try {
                ZoneId.of(zone);
            } catch (DateTimeException e) {
                throw new IllegalArgumentException("Unknown time zone: " + zone);
            }
        }
    }

    public boolean isQuietAt(Instant now) {
        if (!enabled || startMinute == endMinute) return false;
        ZonedDateTime local = ZonedDateTime.ofInstant(now, ZoneId.of(zone));
        int minute = local.getHour() * 60 + local.getMinute();
        return startMinute < endMinute
                ? minute >= startMinute && minute < endMinute
                : minute >= startMinute || minute < endMinute;
    }
}
