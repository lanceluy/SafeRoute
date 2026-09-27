package com.saferoute.backend.websocket;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.saferoute.backend.event.dto.HazardChange;
import com.saferoute.backend.hazard.HazardStatus;
import com.saferoute.backend.hazard.HazardType;

import java.time.Instant;
import java.util.UUID;

/** Sent to the people who reported a hazard when something happens to it (see ReportFollowUpConsumer). */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ReportUpdateFrame(String type, UUID hazardId, HazardType hazardType, HazardChange change, HazardStatus status,
                                String assignedDepartment, String title, String body, Instant occurredAt) {

    public ReportUpdateFrame(UUID hazardId, HazardType hazardType, HazardChange change, HazardStatus status,
                             String assignedDepartment, String title, String body, Instant occurredAt) {
        this("report_update", hazardId, hazardType, change, status, assignedDepartment, title, body, occurredAt);
    }
}
