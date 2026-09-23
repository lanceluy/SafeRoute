package com.saferoute.backend.event.dto;

import com.saferoute.backend.confirmation.ResolutionAction;
import com.saferoute.backend.event.EventMetadata;

import java.util.UUID;

public record ResolutionRequestedEvent(
        EventMetadata metadata,
        UUID hazardId,
        UUID userId,
        ResolutionAction action
) {
}
