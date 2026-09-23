package com.saferoute.backend.hazard.dto;

import com.saferoute.backend.confirmation.HazardAuditLog;

import java.time.Instant;
import java.util.UUID;

/**
 * One line of a hazard's history. {@code actor} is a role (REPORTER / COMMUNITY / MODERATOR /
 * SYSTEM), never a user id, so the public timeline doesn't expose who confirmed what.
 */
public record HazardTimelineEntry(UUID id, HazardAuditLog.Action action, String field, String oldValue,
                                  String newValue, String note, String actor, Instant at) {
}
