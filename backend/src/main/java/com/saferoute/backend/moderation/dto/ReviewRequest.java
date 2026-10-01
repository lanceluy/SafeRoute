package com.saferoute.backend.moderation.dto;

import jakarta.validation.constraints.Size;

/** Optional note for "Mark reviewed". */
public record ReviewRequest(@Size(max = 500) String note) {
}
