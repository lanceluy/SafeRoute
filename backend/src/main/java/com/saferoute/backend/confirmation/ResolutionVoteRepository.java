package com.saferoute.backend.confirmation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface ResolutionVoteRepository extends JpaRepository<ResolutionVote, UUID> {

    Optional<ResolutionVote> findByHazardIdAndUserId(UUID hazardId, UUID userId);

    long countByHazardIdAndAction(UUID hazardId, ResolutionAction action);

    @Modifying
    @Query("DELETE FROM ResolutionVote v WHERE v.hazardId = :hazardId")
    int deleteByHazardId(@Param("hazardId") UUID hazardId);
}
