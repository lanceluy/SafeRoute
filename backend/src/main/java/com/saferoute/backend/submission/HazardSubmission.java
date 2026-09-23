package com.saferoute.backend.submission;

import com.saferoute.backend.hazard.HazardType;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * One user report, tracked separately from the canonical hazard it ends up as (review §10).
 * Several submissions may point at the same {@code canonicalHazardId} after dedup merging.
 */
@Entity
@Table(name = "hazard_submissions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class HazardSubmission {

    @Id
    private UUID id;

    @Column(name = "reporter_id", nullable = false)
    private UUID reporterId;

    @Enumerated(EnumType.STRING)
    @Column(name = "submitted_type", nullable = false, length = 40)
    private HazardType submittedType;

    @Column(nullable = false)
    private double latitude;

    @Column(nullable = false)
    private double longitude;

    @Column(columnDefinition = "text")
    private String description;

    @Column(name = "photo_url", length = 500)
    private String photoUrl;

    @Column(name = "severity_answer", length = 40)
    private String severityAnswer;

    @Enumerated(EnumType.STRING)
    @Column(name = "processing_status", nullable = false, length = 20)
    @Builder.Default
    private SubmissionStatus processingStatus = SubmissionStatus.QUEUED;

    @Column(name = "canonical_hazard_id")
    private UUID canonicalHazardId;

    @Column(name = "failure_reason", columnDefinition = "text")
    private String failureReason;

    @Column(name = "correlation_id", length = 64)
    private String correlationId;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "processed_at")
    private Instant processedAt;
}
