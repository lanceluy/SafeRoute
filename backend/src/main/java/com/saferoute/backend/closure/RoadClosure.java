package com.saferoute.backend.closure;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.LineString;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "road_closures")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoadClosure {

    @Id
    private UUID id;

    /** SRID 4326 geography(LineString); x = longitude, y = latitude. */
    @Column(nullable = false, columnDefinition = "geography(LineString,4326)")
    private LineString geom;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 500)
    private String reason;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ClosureCategory category;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    @Builder.Default
    private ClosureStatus status = ClosureStatus.ACTIVE;

    /** How far either side of the drawn line counts as blocked when checking routes. */
    @Column(name = "buffer_meters", nullable = false)
    @Builder.Default
    private int bufferMeters = 15;

    @Column(name = "starts_at", nullable = false)
    @Builder.Default
    private Instant startsAt = Instant.now();

    /** Null = open-ended; stays blocked until lifted. */
    @Column(name = "ends_at")
    private Instant endsAt;

    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @Column(name = "lifted_by")
    private UUID liftedBy;

    @Column(name = "lifted_at")
    private Instant liftedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    @PreUpdate
    public void onUpdate() {
        this.updatedAt = Instant.now();
    }

    /** Vertices as [latitude, longitude] pairs, the order every client API uses. */
    public double[][] latLonVertices() {
        Coordinate[] cs = geom.getCoordinates();
        double[][] out = new double[cs.length][];
        for (int i = 0; i < cs.length; i++) out[i] = new double[]{cs[i].y, cs[i].x};
        return out;
    }
}
