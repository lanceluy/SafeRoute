package com.saferoute.backend.submission;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public interface HazardSubmissionRepository extends JpaRepository<HazardSubmission, UUID> {

    Page<HazardSubmission> findByReporterIdOrderByCreatedAtDesc(UUID reporterId, Pageable pageable);

    long countByReporterId(UUID reporterId);

    Optional<HazardSubmission> findByReporterIdAndClientRequestId(UUID reporterId, UUID clientRequestId);

    /**
     * Terminal transitions are conditional: a submission that already reached an outcome is never
     * overwritten. @return 1 if this call made the transition.
     */
    @Modifying(clearAutomatically = true)
    @Query("""
        UPDATE HazardSubmission s SET s.processingStatus = :failed, s.failureReason = :reason, s.processedAt = :now
        WHERE s.id = :id AND s.processingStatus IN :pending""")
    int markFailedIfPending(@Param("id") UUID id,
                            @Param("reason") String reason,
                            @Param("now") Instant now,
                            @Param("failed") SubmissionStatus failed,
                            @Param("pending") Collection<SubmissionStatus> pending);
}
