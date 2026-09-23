package com.saferoute.backend.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    Optional<User> findByEmailIgnoreCase(String email);

    boolean existsByEmailIgnoreCase(String email);

    List<User> findByIdIn(Collection<UUID> ids);

    /** Atomic increment so concurrent consumers can't lose each other's reputation updates. */
    @Modifying
    @Query("UPDATE User u SET u.reputationScore = u.reputationScore + :delta WHERE u.id = :userId")
    int addReputation(@Param("userId") UUID userId, @Param("delta") int delta);
}
