package com.saferoute.backend.push;

import java.util.UUID;

/** A user-visible alert. {@code hazardId} lets the app open the hazard when the alert is tapped. */
public record PushMessage(String title, String body, UUID hazardId) {
}
