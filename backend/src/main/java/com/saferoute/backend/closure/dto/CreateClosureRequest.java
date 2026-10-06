package com.saferoute.backend.closure.dto;

import com.saferoute.backend.closure.ClosureCategory;
import jakarta.validation.constraints.*;

import java.time.Instant;
import java.util.List;

/**
 * @param coordinates  the blocked road as [latitude, longitude] points, at least 2
 * @param bufferMeters optional; how far either side of the line is blocked (default 15)
 * @param endsAt       optional; the closure lifts itself then
 */
public record CreateClosureRequest(
        @NotBlank @Size(max = 120) String name,
        @NotBlank @Size(max = 500) String reason,
        @NotNull ClosureCategory category,
        @NotNull @Size(min = 2, max = 200) List<double[]> coordinates,
        @Min(5) @Max(60) Integer bufferMeters,
        Instant endsAt
) {
}
