package com.saferoute.backend.hazard.dto;

import java.util.UUID;

/** 202 body for asynchronous hazard commands; the result arrives as a hazard_* WebSocket frame. */
public record CommandAccepted(UUID hazardId, String action, String status) {

    public static CommandAccepted queued(UUID hazardId, Enum<?> action) {
        return new CommandAccepted(hazardId, action.name(), "QUEUED");
    }
}
