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
        Resolution resolution
) {
    public record Totals(long active, long highSeverity, long needsReview, long reportedInRange, long resolvedInRange) {
    }

    public record Count(String key, long count) {
    }

    /** One local day: hazards reported and resolved that day, and how many were still active at its end. */
    public record Day(LocalDate date, long reported, long resolved, long backlog) {
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
