package com.saferoute.backend.moderation;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SavedViewRepository extends JpaRepository<SavedView, UUID> {

    List<SavedView> findByUserIdOrderByNameAsc(UUID userId);

    Optional<SavedView> findByIdAndUserId(UUID id, UUID userId);

    Optional<SavedView> findByUserIdAndNameIgnoreCase(UUID userId, String name);

    long countByUserId(UUID userId);
}
