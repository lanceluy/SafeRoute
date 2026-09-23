package com.saferoute.backend.hazard.dto;

import com.saferoute.backend.confirmation.ResolutionAction;
import jakarta.validation.constraints.NotNull;

public record ResolutionVoteRequest(@NotNull ResolutionAction action) {
}
