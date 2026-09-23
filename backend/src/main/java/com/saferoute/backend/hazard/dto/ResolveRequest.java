package com.saferoute.backend.hazard.dto;

import jakarta.validation.constraints.Size;

public record ResolveRequest(@Size(max = 500) String note) {
}
