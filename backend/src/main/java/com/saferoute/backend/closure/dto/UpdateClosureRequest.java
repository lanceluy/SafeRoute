package com.saferoute.backend.closure.dto;

import jakarta.validation.constraints.Size;

import java.time.Instant;

/** Only the fields present are changed. {@code clearEndsAt} makes the closure open-ended. */
public record UpdateClosureRequest(
        @Size(min = 1, max = 120) String name,
        @Size(min = 1, max = 500) String reason,
        Instant endsAt,
        Boolean clearEndsAt
) {
}
