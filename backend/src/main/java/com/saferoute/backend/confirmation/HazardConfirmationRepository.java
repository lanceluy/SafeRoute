package com.saferoute.backend.confirmation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface HazardConfirmationRepository extends JpaRepository<HazardConfirmation, UUID> {

    Optional<HazardConfirmation> findByHazardIdAndUserId(UUID hazardId, UUID userId);

    List<HazardConfirmation> findByHazardId(UUID hazardId);

    long countByHazardIdAndAction(UUID hazardId, ConfirmationAction action);

    boolean existsByHazardId(UUID hazardId);

    long countByUserIdAndAction(UUID userId, ConfirmationAction action);

    /**
     * Opinions of one kind from distinct registration sources, ignoring any from the reporter's own source.
     * Accounts with no recorded source count as their own source.
     */
    @Query(value = """
        SELECT COUNT(DISTINCT COALESCE(u.registration_source, CAST(u.id AS text)))
        FROM hazard_confirmations c
        JOIN users u ON u.id = c.user_id
        JOIN hazards h ON h.id = c.hazard_id
        JOIN users r ON r.id = h.reporter_id
        WHERE c.hazard_id = :hazardId AND c.action = :action
          AND COALESCE(u.registration_source, CAST(u.id AS text)) <> COALESCE(r.registration_source, CAST(r.id AS text))
        """, nativeQuery = true)
    long countIndependent(@Param("hazardId") UUID hazardId, @Param("action") String action);
}
