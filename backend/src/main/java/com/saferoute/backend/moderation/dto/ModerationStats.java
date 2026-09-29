package com.saferoute.backend.moderation.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Everything the portal's Overview and Analytics pages show, for one date range. "Active" counts
 * are as of now; "InRange" counts and the daily series cover {@code from}–{@code to}.
 */
public record ModerationStats(
        Instant from,
        Instant to,
        String timeZone,
        Instant generatedAt,
        Totals totals,
        /** Size of each moderation-queue view (see {@code ModerationQueryService.View}), as of now. */
        Map<String, Long> queueCounts,
        List<Count> activeByType,
        List<Count> activeBySeverity,
        List<Day> daily,
        Resolution resolution,
        /** How hazards left the active map during the range. */
        Outcomes outcomes,
        /** Report-to-verified time of hazards first verified in the range. */
        Verification verification,
        /** Reports received in the range by local weekday (ISO: 1 = Monday) and hour; zero cells omitted. */
        List<HourCount> reportTimes,
        /** Places with repeated hazards reported in the range (removed ones excluded), busiest first. */
        List<Hotspot> hotspots
) {
    public record Totals(long active, long highSeverity, long needsReview, long reportedInRange, long resolvedInRange) {
    }

    public record Count(String key, long count) {
    }

    /**
     * One local day: hazards reported (and by severity) and resolved that day, how many were still
     * active at its end, and how incoming reports were processed (a new hazard, or merged into one).
     */
    public record Day(LocalDate date, long reported, long resolved, long backlog,
                      long reportedHigh, long reportedMedium, long reportedLow,
                      long newReports, long mergedReports) {
    }

    /** Status changes in the range: closed three ways, or reopened after being resolved. */
    public record Outcomes(long resolved, long expired, long removed, long reopened) {
    }

    public record Verification(Double averageHours, long verifiedCount, List<TypeResolution> byType) {
    }

    public record HourCount(int dayOfWeek, int hour, long count) {
    }

    /** A cell of roughly 165 m: the centre of its hazards, how many, and the most common type. */
    public record Hotspot(double latitude, double longitude, long count, String topType) {
    }

    /**
     * Report-to-resolution time of hazards RESOLVED in the range (removed and expired ones don't
     * count). {@code previousAverageHours} is the same-length period just before, for comparison.
     */
    public record Resolution(Double averageHours, Double previousAverageHours, long resolvedCount,
                             List<TypeResolution> byType) {
    }

    public record TypeResolution(String type, double averageHours, long count) {
    }
}
