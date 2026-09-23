package com.saferoute.backend.confirmation;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "hazard_audit_log")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class HazardAuditLog {

    public enum Action {
        CREATED,
        DUPLICATE_MERGED,
        CONFIRMATION_CHANGED,
        RESOLUTION_VOTE,
        STATUS_CHANGED,
        FIELD_EDITED,
        MODERATOR_RESOLVED,
        MODERATOR_REOPENED,
        MODERATOR_REMOVED
    }

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "hazard_id", nullable = false)
    private UUID hazardId;

    @Column(name = "actor_id")
    private UUID actorId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private Action action;

    @Column(name = "field_name", length = 40)
    private String fieldName;

    @Column(name = "old_value", columnDefinition = "text")
    private String oldValue;

    @Column(name = "new_value", columnDefinition = "text")
    private String newValue;

    @Column(columnDefinition = "text")
    private String note;

    @Column(name = "correlation_id", length = 64)
    private String correlationId;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();
}
