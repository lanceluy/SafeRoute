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
@Table(name = "hazard_resolution_votes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ResolutionVote {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "hazard_id", nullable = false)
    private UUID hazardId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ResolutionAction action;

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
