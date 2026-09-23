package com.saferoute.backend.common;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/** {@code error} carries a stable code (e.g. RATE_LIMITED); {@code message} is human-readable. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiErrorResponse(Instant timestamp, int status, String error, String message,
                               Long retryAfterSeconds, String correlationId) {

    public static ApiErrorResponse of(int status, String error, String message) {
        return new ApiErrorResponse(Instant.now(), status, error, message, null, Correlation.currentId());
    }

    public static ApiErrorResponse rateLimited(String message, long retryAfterSeconds) {
        return new ApiErrorResponse(Instant.now(), 429, "RATE_LIMITED", message, retryAfterSeconds, Correlation.currentId());
    }
}
