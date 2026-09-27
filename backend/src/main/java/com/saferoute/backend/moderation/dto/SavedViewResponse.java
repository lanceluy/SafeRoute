package com.saferoute.backend.moderation.dto;

import com.saferoute.backend.moderation.SavedView;

import java.time.Instant;
import java.util.UUID;

public record SavedViewResponse(UUID id, String name, String config, Instant createdAt) {
    public static SavedViewResponse from(SavedView v) {
        return new SavedViewResponse(v.getId(), v.getName(), v.getConfig(), v.getCreatedAt());
    }
}
