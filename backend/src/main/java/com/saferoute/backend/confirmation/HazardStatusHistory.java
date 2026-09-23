package com.saferoute.backend.confirmation;

import com.saferoute.backend.hazard.HazardStatus;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "hazard_status_history")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class HazardStatusHistory {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "hazard_id", nullable = false)
    private UUID hazardId;

    @Enumerated(EnumType.STRING)
    @Column(name = "old_status", length = 20)
    private HazardStatus oldStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "new_status", nullable = false, length = 20)
    private HazardStatus newStatus;

    @Column(name = "changed_by")
    private UUID changedBy;

    @Column(name = "changed_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant changedAt = Instant.now();

    @Column(columnDefinition = "text")
    private String note;
}
