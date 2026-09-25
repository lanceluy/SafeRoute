package com.saferoute.backend.hazard;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spatial filtering deliberately uses native SQL (not JPQL spatial functions) so the
 * queries below can be copy-pasted straight into psql for debugging/demoing PostGIS
 * behaviour, per the project's spatial-query convention. {@code :types} and {@code :statuses}
 * are comma-separated enum names.
 */
public interface HazardRepository extends JpaRepository<Hazard, UUID> {

    @Query(value = """
        SELECT * FROM hazards
        WHERE status = ANY(string_to_array(:statuses, ','))
          AND (:types IS NULL OR type = ANY(string_to_array(:types, ',')))
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radiusMeters)
        ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography)
        LIMIT :limit
        """, nativeQuery = true)
    List<Hazard> findNearby(@Param("lat") double lat,
                            @Param("lon") double lon,
                            @Param("radiusMeters") double radiusMeters,
                            @Param("types") String commaSeparatedTypesOrNull,
                            @Param("statuses") String commaSeparatedStatuses,
                            @Param("limit") int limit);

    /**
     * Identity policy for dedup: an <em>active</em> hazard of the same type within the radius is
     * the same physical hazard, however long ago it was first reported — a broken sidewalk stays
     * on the map for weeks. Freshness is tracked separately (last_confirmed_at / expires_at).
     */
    @Query(value = """
        SELECT * FROM hazards
        WHERE type = :type
          AND status IN ('REPORTED', 'VERIFIED', 'DISPUTED')
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radiusMeters)
        ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography)
        LIMIT 1
        """, nativeQuery = true)
    List<Hazard> findPotentialDuplicates(@Param("lat") double lat,
                                         @Param("lon") double lon,
                                         @Param("type") String type,
                                         @Param("radiusMeters") double radiusMeters);

    /**
     * Every active hazard within {@code corridorMeters} of any of the given lines (WKT
     * MULTILINESTRING, lon/lat order). Callers pass {@code limit + 1} to detect truncation.
     */
    @Query(value = """
        SELECT * FROM hazards
        WHERE status IN ('REPORTED', 'VERIFIED', 'DISPUTED')
          AND ST_DWithin(location, ST_GeogFromText(:wkt), :corridorMeters)
        ORDER BY id
        LIMIT :limit
        """, nativeQuery = true)
    List<Hazard> findAlongLines(@Param("wkt") String multiLineStringWkt,
                                @Param("corridorMeters") double corridorMeters,
                                @Param("limit") int limit);

    /** Row-locks the hazard so community commands on the same hazard are evaluated one at a time. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT h FROM Hazard h WHERE h.id = :id")
    Optional<Hazard> findByIdForUpdate(@Param("id") UUID id);

    @Query(value = """
        SELECT * FROM hazards
        WHERE status = ANY(string_to_array(:statuses, ','))
          AND (:types IS NULL OR type = ANY(string_to_array(:types, ',')))
          AND ST_Intersects(
                location,
                ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326)::geography
              )
        ORDER BY updated_at DESC
        LIMIT :limit
        """, nativeQuery = true)
    List<Hazard> findInBbox(@Param("minLat") double minLat,
                            @Param("minLon") double minLon,
                            @Param("maxLat") double maxLat,
                            @Param("maxLon") double maxLon,
                            @Param("types") String commaSeparatedTypesOrNull,
                            @Param("statuses") String commaSeparatedStatuses,
                            @Param("limit") int limit);

    @Query(value = """
        SELECT id FROM hazards
        WHERE status IN ('REPORTED', 'VERIFIED', 'DISPUTED') AND expires_at < :now
        ORDER BY expires_at
        LIMIT :limit
        """, nativeQuery = true)
    List<UUID> findExpiredIds(@Param("now") Instant now, @Param("limit") int limit);

    /**
     * Moderation queue: disputed first, then hazards whose reporters have the least reputation —
     * reputation is used as one ordering signal, never as a verdict.
     */
    @Query(value = """
        SELECT h.* FROM hazards h JOIN users u ON u.id = h.reporter_id
        WHERE h.status = ANY(string_to_array(:statuses, ','))
        ORDER BY (h.status = 'DISPUTED') DESC, u.reputation_score ASC, h.updated_at DESC
        LIMIT :limit OFFSET :offset
        """, nativeQuery = true)
    List<Hazard> findModerationQueue(@Param("statuses") String commaSeparatedStatuses,
                                     @Param("limit") int limit,
                                     @Param("offset") int offset);

    @Query(value = "SELECT count(*) FROM hazards WHERE status = ANY(string_to_array(:statuses, ','))", nativeQuery = true)
    long countByStatuses(@Param("statuses") String commaSeparatedStatuses);

    List<Hazard> findByIdIn(Collection<UUID> ids);

    long countByReporterIdAndReporterRewardedTrue(UUID reporterId);
}
