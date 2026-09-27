package com.saferoute.backend.moderation.dto;

import com.saferoute.backend.hazard.MunicipalPriority;
import jakarta.validation.constraints.Size;

/**
 * The city's response to a hazard, replacing the previous one: {@code department} is a code from
 * /api/meta/departments or null (unassigned); {@code priority} null means not set.
 */
public record MunicipalResponseRequest(@Size(max = 40) String department, MunicipalPriority priority,
                                       @Size(max = 500) String note) {
}
