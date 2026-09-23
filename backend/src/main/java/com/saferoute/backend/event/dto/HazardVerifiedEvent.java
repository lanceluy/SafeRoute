package com.saferoute.backend.event.dto;

import com.saferoute.backend.confirmation.ConfirmationAction;
import com.saferoute.backend.event.EventMetadata;

import java.util.UUID;

/** A user's confirmation opinion was set (upsert semantics: the latest action wins). */
public record HazardVerifiedEvent(
        EventMetadata metadata,
        UUID hazardId,
        UUID verifierUserId,
        ConfirmationAction action
) {
}
