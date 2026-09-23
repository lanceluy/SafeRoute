package com.saferoute.backend.hazard.dto;

import com.saferoute.backend.confirmation.ConfirmationAction;
import jakarta.validation.constraints.NotNull;

public record ConfirmationRequest(@NotNull ConfirmationAction action) {
}
