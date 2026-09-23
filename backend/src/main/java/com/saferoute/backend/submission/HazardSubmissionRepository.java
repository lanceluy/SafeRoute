package com.saferoute.backend.submission;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface HazardSubmissionRepository extends JpaRepository<HazardSubmission, UUID> {

    Page<HazardSubmission> findByReporterIdOrderByCreatedAtDesc(UUID reporterId, Pageable pageable);

    long countByReporterId(UUID reporterId);
}
