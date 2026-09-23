package com.saferoute.backend.confirmation;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface HazardStatusHistoryRepository extends JpaRepository<HazardStatusHistory, UUID> {

    List<HazardStatusHistory> findByHazardIdOrderByChangedAtAsc(UUID hazardId);
}
