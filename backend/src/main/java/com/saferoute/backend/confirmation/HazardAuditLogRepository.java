package com.saferoute.backend.confirmation;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface HazardAuditLogRepository extends JpaRepository<HazardAuditLog, UUID> {

    List<HazardAuditLog> findByHazardIdOrderByCreatedAtAsc(UUID hazardId);
}
