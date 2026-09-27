package com.saferoute.backend.push;

import java.util.UUID;

/**
 * A user-visible alert. {@code hazardId} lets the app open the hazard when the alert is tapped;
 * {@code kind} is "hazard_alert" or "report_update".
 */
public record PushMessage(String title, String body, UUID hazardId, String kind) {
    public PushMessage(String title, String body, UUID hazardId) {
        this(title, body, hazardId, "hazard_alert");
    }
}
