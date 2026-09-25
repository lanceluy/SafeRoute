package com.saferoute.backend.push;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface PushDeviceRepository extends JpaRepository<PushDevice, String> {

    /** Devices whose last location is fresh and inside the box; callers refine by exact distance. */
    @Query("""
            SELECT d FROM PushDevice d
            WHERE d.locationUpdatedAt > :since
              AND d.latitude BETWEEN :minLat AND :maxLat
              AND d.longitude BETWEEN :minLon AND :maxLon
            """)
    List<PushDevice> findWithFreshLocationIn(@Param("since") Instant since,
                                             @Param("minLat") double minLat, @Param("maxLat") double maxLat,
                                             @Param("minLon") double minLon, @Param("maxLon") double maxLon);

    @Modifying
    @Query("""
            UPDATE PushDevice d SET d.latitude = null, d.longitude = null, d.locationUpdatedAt = null
            WHERE d.locationUpdatedAt <= :cutoff
            """)
    int clearLocationsOlderThan(@Param("cutoff") Instant cutoff);
}
