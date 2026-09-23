package com.saferoute.backend.submission.dto;

import com.saferoute.backend.hazard.HazardType;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * @param photoUrl       must be a URL returned by POST /api/uploads/hazard-image
 * @param severityAnswer one of the option values from GET /api/meta/severity-questions for this type
 */
public record HazardSubmissionRequest(
        @NotNull HazardType type,
        @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
        @Size(max = 1000) String description,
        @Size(max = 500) String photoUrl,
        @Size(max = 40) String severityAnswer
) {
}
