package com.saferoute.backend.event.dto;

import com.saferoute.backend.event.EventMetadata;

import java.util.UUID;

/** Moderator/official resolution command (authorization already checked by the API). */
public record HazardResolvedEvent(
        EventMetadata metadata,
        UUID hazardId,
        UUID resolvedByUserId,
        String resolutionNote
) {
}
