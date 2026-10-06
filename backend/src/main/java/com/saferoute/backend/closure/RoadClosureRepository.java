package com.saferoute.backend.closure;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RoadClosureRepository extends JpaRepository<RoadClosure, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT c FROM RoadClosure c WHERE c.id = :id")
    Optional<RoadClosure> findByIdForUpdate(@Param("id") UUID id);

    @Query(value = """
        SELECT * FROM road_closures
        WHERE status = 'ACTIVE'
        ORDER BY created_at DESC
        LIMIT :limit
        """, nativeQuery = true)
    List<RoadClosure> findActive(@Param("limit") int limit);

    @Query(value = """
        SELECT * FROM road_closures
        WHERE status = 'ACTIVE'
          AND ST_Intersects(geom, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326)::geography)
        ORDER BY created_at DESC
        LIMIT :limit
        """, nativeQuery = true)
    List<RoadClosure> findActiveInBbox(@Param("minLat") double minLat,
                                       @Param("minLon") double minLon,
                                       @Param("maxLat") double maxLat,
                                       @Param("maxLon") double maxLon,
                                       @Param("limit") int limit);

    /**
     * Active closures whose blocked band (the line widened by its own buffer) comes within
     * {@code corridorMeters} of any route line (WKT MULTILINESTRING, lon/lat order).
     */
    @Query(value = """
        SELECT * FROM road_closures
        WHERE status = 'ACTIVE'
          AND ST_DWithin(geom, ST_GeogFromText(:wkt), :corridorMeters + buffer_meters)
        ORDER BY id
        LIMIT :limit
        """, nativeQuery = true)
    List<RoadClosure> findActiveAlongLines(@Param("wkt") String multiLineStringWkt,
                                           @Param("corridorMeters") double corridorMeters,
                                           @Param("limit") int limit);

    @Query(value = """
        SELECT id FROM road_closures
        WHERE status = 'ACTIVE' AND ends_at IS NOT NULL AND ends_at < :now
        ORDER BY ends_at
        LIMIT :limit
        """, nativeQuery = true)
    List<UUID> findExpiredIds(@Param("now") Instant now, @Param("limit") int limit);
}
