package com.saferoute.backend.hazard.dto;

import com.saferoute.backend.hazard.HazardType;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Size;

/**
 * Null fields are left unchanged. Reporters may edit description/photo; type, location and
 * severity answer only while the hazard is still REPORTED (and location by at most 50 m).
 * Moderators may edit everything.
 */
public record UpdateHazardRequest(
        @Size(max = 1000) String description,
        @Size(max = 500) String photoUrl,
        HazardType type,
        @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
        @Size(max = 40) String severityAnswer
) {
}
