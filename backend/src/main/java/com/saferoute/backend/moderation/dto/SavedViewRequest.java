package com.saferoute.backend.moderation.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Saving under an existing name replaces that view. */
public record SavedViewRequest(@NotBlank @Size(max = 80) String name, @NotBlank @Size(max = 4000) String config) {
}
