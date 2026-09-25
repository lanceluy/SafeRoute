package com.saferoute.backend.confirmation;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/** A user's single current opinion about a hazard (UNIQUE(hazard_id, user_id)). */
@Entity
@Table(name = "hazard_confirmations", uniqueConstraints = {
        @UniqueConstraint(name = "uq_confirmation_hazard_user", columnNames = {"hazard_id", "user_id"})
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class HazardConfirmation {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "hazard_id", nullable = false)
    private UUID hazardId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private ConfirmationAction action;

    @Column(name = "reputation_awarded", nullable = false)
    @Builder.Default
    private boolean reputationAwarded = false;

    /** The hazard content revision this opinion assessed. */
    @Column(name = "hazard_revision", nullable = false)
    @Builder.Default
    private int hazardRevision = 0;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();
}
