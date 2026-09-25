package com.saferoute.backend.submission.dto;

import com.saferoute.backend.hazard.HazardType;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.UUID;

/**
 * @param photoUrl        must be a URL returned to the same user by POST /api/uploads/hazard-image
 * @param severityAnswer  one of the option values from GET /api/meta/severity-questions for this type
 * @param clientRequestId optional idempotency key, generated once per logical report; retrying
 *                        with the same key returns the original submission instead of a new one
 * @param observedAt      optional time the reporter saw the hazard (e.g. a report queued offline);
 *                        defaults to now. Freshness and expiry are measured from it.
 */
public record HazardSubmissionRequest(
        @NotNull HazardType type,
        @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
        @Size(max = 1000) String description,
        @Size(max = 500) String photoUrl,
        @Size(max = 40) String severityAnswer,
        UUID clientRequestId,
        Instant observedAt
) {
}
