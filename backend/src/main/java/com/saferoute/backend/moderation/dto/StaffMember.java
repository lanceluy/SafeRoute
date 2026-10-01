package com.saferoute.backend.moderation.dto;

import java.time.Instant;
import java.util.UUID;

/** A portal account: who they are, and who gave them access (null for bootstrap/seeded accounts). */
public record StaffMember(UUID id, String email, String displayName, String role, Instant createdAt,
                          String addedBy, Instant addedAt) {
}
