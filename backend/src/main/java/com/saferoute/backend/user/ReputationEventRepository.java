package com.saferoute.backend.user;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ReputationEventRepository extends JpaRepository<ReputationEvent, UUID> {

    List<ReputationEvent> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    long countByUserIdAndReason(UUID userId, ReputationEvent.Reason reason);
}
