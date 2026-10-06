package com.saferoute.backend.closure;

import com.saferoute.backend.closure.dto.ClosureResponse;
import com.saferoute.backend.closure.dto.CreateClosureRequest;
import com.saferoute.backend.closure.dto.UpdateClosureRequest;
import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.coverage.CoverageArea;
import com.saferoute.backend.event.dto.ClosureChangedEvent;
import com.saferoute.backend.event.producer.HazardEventProducer;
import com.saferoute.backend.spatial.GeoUtils;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class RoadClosureService {

    static final double MAX_BBOX_SPAN_DEGREES = 0.5;
    static final int MAX_RESULTS = 200;
    /** A closure shorter than this is a mis-click, not a road. */
    static final double MIN_LENGTH_METERS = 5;

    private final RoadClosureRepository repository;
    private final HazardEventProducer eventProducer;
    private final CoverageArea coverageArea;
    private final JdbcTemplate jdbc;

    public RoadClosureService(RoadClosureRepository repository, HazardEventProducer eventProducer,
                              CoverageArea coverageArea, JdbcTemplate jdbc) {
        this.repository = repository;
        this.eventProducer = eventProducer;
        this.coverageArea = coverageArea;
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------ queries

    @Transactional(readOnly = true)
    public List<ClosureResponse> findActive() {
        return repository.findActive(MAX_RESULTS).stream().map(ClosureResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public List<ClosureResponse> findInBbox(double minLat, double minLon, double maxLat, double maxLon) {
        if (minLat >= maxLat || minLon >= maxLon) {
            throw badRequest("Bounding box must satisfy minLat < maxLat and minLon < maxLon");
        }
        if (maxLat - minLat > MAX_BBOX_SPAN_DEGREES || maxLon - minLon > MAX_BBOX_SPAN_DEGREES) {
            throw badRequest("Bounding box is too large (max " + MAX_BBOX_SPAN_DEGREES + "° per side); zoom in");
        }
        return repository.findActiveInBbox(minLat, minLon, maxLat, maxLon, MAX_RESULTS)
                .stream().map(ClosureResponse::from).toList();
    }

    /** Closures near a route set; {@code wkt} is the MULTILINESTRING HazardService already validated. */
    @Transactional(readOnly = true)
    public List<ClosureResponse> findAlongWkt(String wkt, double corridorMeters) {
        return repository.findActiveAlongLines(wkt, corridorMeters, MAX_RESULTS)
                .stream().map(ClosureResponse::from).toList();
    }

    // ------------------------------------------------------------------ commands

    @Transactional
    public ClosureResponse create(UUID actorId, CreateClosureRequest request) {
        for (double[] p : request.coordinates()) {
            if (p == null || p.length != 2) throw badRequest("Coordinates must be [latitude, longitude] pairs");
            coverageArea.requireCovered(p[0], p[1]);
        }
        if (request.endsAt() != null && !request.endsAt().isAfter(Instant.now())) {
            throw badRequest("endsAt must be in the future");
        }
        var line = GeoUtils.lineString(request.coordinates());
        if (lengthMeters(request.coordinates()) < MIN_LENGTH_METERS) {
            throw badRequest("The closure is too short; draw along the road you want to block");
        }
        RoadClosure closure = RoadClosure.builder()
                .id(UUID.randomUUID())
                .geom(line)
                .name(request.name().trim())
                .reason(request.reason().trim())
                .category(request.category())
                .bufferMeters(request.bufferMeters() != null ? request.bufferMeters() : 15)
                .endsAt(request.endsAt())
                .createdBy(actorId)
                .build();
        repository.saveAndFlush(closure);
        audit(closure.getId(), actorId, "CREATED", closure.getReason());
        eventProducer.publishClosureChanged(closure, ClosureChangedEvent.Change.CREATED, actorId);
        return ClosureResponse.from(closure);
    }

    @Transactional
    public ClosureResponse update(UUID id, UUID actorId, UpdateClosureRequest request) {
        RoadClosure closure = requireActive(id);
        if (request.name() != null) closure.setName(request.name().trim());
        if (request.reason() != null) closure.setReason(request.reason().trim());
        if (Boolean.TRUE.equals(request.clearEndsAt())) {
            closure.setEndsAt(null);
        } else if (request.endsAt() != null) {
            if (!request.endsAt().isAfter(Instant.now())) throw badRequest("endsAt must be in the future");
            closure.setEndsAt(request.endsAt());
        }
        repository.saveAndFlush(closure);
        audit(id, actorId, "UPDATED", null);
        eventProducer.publishClosureChanged(closure, ClosureChangedEvent.Change.UPDATED, actorId);
        return ClosureResponse.from(closure);
    }

    @Transactional
    public ClosureResponse lift(UUID id, UUID actorId, String reason) {
        RoadClosure closure = requireActive(id);
        closure.setStatus(ClosureStatus.LIFTED);
        closure.setLiftedBy(actorId);
        closure.setLiftedAt(Instant.now());
        repository.saveAndFlush(closure);
        audit(id, actorId, "LIFTED", reason);
        eventProducer.publishClosureChanged(closure, ClosureChangedEvent.Change.LIFTED, actorId);
        return ClosureResponse.from(closure);
    }

    /** @return true if the closure was expired (it may have been lifted or extended in the meantime). */
    @Transactional
    public boolean expire(UUID id) {
        RoadClosure closure = repository.findByIdForUpdate(id).orElse(null);
        if (closure == null || closure.getStatus() != ClosureStatus.ACTIVE
                || closure.getEndsAt() == null || closure.getEndsAt().isAfter(Instant.now())) {
            return false;
        }
        closure.setStatus(ClosureStatus.EXPIRED);
        repository.saveAndFlush(closure);
        audit(id, null, "EXPIRED", "Reached its end time");
        eventProducer.publishClosureChanged(closure, ClosureChangedEvent.Change.EXPIRED, null);
        return true;
    }

    // ------------------------------------------------------------------ helpers

    private RoadClosure requireActive(UUID id) {
        RoadClosure closure = repository.findByIdForUpdate(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CLOSURE_NOT_FOUND", "Road closure not found"));
        if (closure.getStatus() != ClosureStatus.ACTIVE) {
            throw new ApiException(HttpStatus.CONFLICT, "CLOSURE_NOT_ACTIVE", "This closure is already " + closure.getStatus());
        }
        return closure;
    }

    private void audit(UUID closureId, UUID actorId, String action, String note) {
        jdbc.update("INSERT INTO road_closure_audit (closure_id, actor_id, action, note) VALUES (?, ?, ?, ?)",
                closureId, actorId, action, note);
    }

    private static double lengthMeters(List<double[]> latLon) {
        double total = 0;
        for (int i = 1; i < latLon.size(); i++) {
            total += GeoUtils.distanceMeters(latLon.get(i - 1)[0], latLon.get(i - 1)[1], latLon.get(i)[0], latLon.get(i)[1]);
        }
        return total;
    }

    private static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
    }
}
