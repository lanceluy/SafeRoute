package com.saferoute.backend.hazard;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.locationtech.jts.geom.Point;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "hazards")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Hazard {

    /**
     * Assigned by the Hazard Processing Service when a submission creates a new hazard. Clients
     * learn it from the submission's canonicalHazardId (see HazardSubmission).
     */
    @Id
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private HazardType type;

    /** SRID 4326 geography(Point). Stored/queried in meters via ST_DWithin/ST_Distance. */
    @Column(nullable = false, columnDefinition = "geography(Point,4326)")
    private Point location;

    @Column(columnDefinition = "text")
    private String description;

    @Column(name = "photo_url", length = 500)
    private String photoUrl;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private HazardStatus status = HazardStatus.REPORTED;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    @Builder.Default
    private Severity severity = Severity.MEDIUM;

    /** Answer to the type-specific severity question (e.g. KNEE_OR_HIGHER for flooding). */
    @Column(name = "severity_answer", length = 40)
    private String severityAnswer;

    /** Number of independent VERIFY confirmations (never includes the reporter). */
    @Column(name = "confirmation_count", nullable = false)
    @Builder.Default
    private Integer confirmationCount = 0;

    @Column(name = "dispute_count", nullable = false)
    @Builder.Default
    private Integer disputeCount = 0;

    @Column(name = "reporter_id", nullable = false)
    private UUID reporterId;

    @Column(name = "duplicate_of_hazard_id")
    private UUID duplicateOfHazardId;

    @Column(name = "last_confirmed_at", nullable = false)
    @Builder.Default
    private Instant lastConfirmedAt = Instant.now();

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "reporter_rewarded", nullable = false)
    @Builder.Default
    private boolean reporterRewarded = false;

    /**
     * Incremented when the assessed content changes (moderator reopen, type/location/severity
     * edit). Community commands carry the revision they were accepted under and are dropped if
     * it no longer matches, so an opinion is never applied to content its author didn't see.
     */
    @Column(name = "content_revision", nullable = false)
    @Builder.Default
    private int contentRevision = 0;

    /** Null until first persisted, which is how Spring Data tells new hazards from existing ones. */
    @Version
    @Column(nullable = false)
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @PreUpdate
    public void onUpdate() {
        this.updatedAt = Instant.now();
    }

    public double latitude() {
        return location.getY(); // JTS Point: y=lat
    }

    public double longitude() {
        return location.getX(); // JTS Point: x=lon
    }

    public Confidence confidence() {
        return HazardLifecycle.confidence(status, confirmationCount, disputeCount);
    }
}
