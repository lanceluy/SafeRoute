package com.saferoute.backend.moderation.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One audit-log line for the staff activity feed. Staff actors are named; commuters are
 * described only as the reporter or a community member, as in the public timeline.
 */
public record ActivityEntry(
        UUID id,
        UUID hazardId,
        String hazardType,
        String hazardSeverity,
        double latitude,
        double longitude,
        String action,
        String field,
        String oldValue,
        String newValue,
        String note,
        Actor actor,
        Instant at
) {
    /**
     * {@code kind} is STAFF, REPORTER, COMMUNITY or SYSTEM. {@code name}, {@code email} and
     * {@code role} are only set for STAFF.
     */
    public record Actor(String kind, String name, String email, String role) {
    }
}
