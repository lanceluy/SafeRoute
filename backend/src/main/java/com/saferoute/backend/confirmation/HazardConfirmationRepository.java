package com.saferoute.backend.confirmation;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface HazardConfirmationRepository extends JpaRepository<HazardConfirmation, UUID> {

    Optional<HazardConfirmation> findByHazardIdAndUserId(UUID hazardId, UUID userId);

    List<HazardConfirmation> findByHazardId(UUID hazardId);

    long countByHazardIdAndAction(UUID hazardId, ConfirmationAction action);

    long countByUserIdAndAction(UUID userId, ConfirmationAction action);
}
