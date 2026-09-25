package com.saferoute.backend.hazard;

import com.saferoute.backend.auth.AuthenticatedUser;
import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.common.PageResponse;
import com.saferoute.backend.confirmation.*;
import com.saferoute.backend.coverage.CoverageArea;
import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.*;
import com.saferoute.backend.event.producer.HazardEventProducer;
import com.saferoute.backend.hazard.dto.*;
import com.saferoute.backend.spatial.GeoUtils;
import com.saferoute.backend.spatial.HazardClassifier;
import com.saferoute.backend.submission.HazardSubmission;
import com.saferoute.backend.submission.HazardSubmissionRepository;
import com.saferoute.backend.submission.SubmissionStatus;
import com.saferoute.backend.submission.dto.HazardSubmissionResponse;
import com.saferoute.backend.upload.ImageUploadService;
import com.saferoute.backend.user.ReputationService;
import com.saferoute.backend.user.TrustLevel;
import com.saferoute.backend.user.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * REST-facing layer. The community lifecycle (report / confirm / resolution vote / moderator
 * resolve) is genuinely asynchronous: this service validates and authorizes, then publishes a
 * Kafka command that {@code HazardProcessingConsumer} applies. Field edits and the rare
 * moderator reopen/remove are synchronous CRUD that emit a hazard_updated event afterwards.
 */
@Service
public class HazardService {

    static final double DEFAULT_RADIUS_METERS = 1000;
    static final double MIN_RADIUS_METERS = 50;
    static final double MAX_RADIUS_METERS = 5000;
    static final int DEFAULT_LIMIT = 100;
    static final int MAX_LIMIT = 250;
    /** ~55 km — anything larger is not a map viewport a pedestrian app needs. */
    static final double MAX_BBOX_SPAN_DEGREES = 0.5;
    static final double REPORTER_MAX_MOVE_METERS = 50;
    static final String ACTIVE_STATUSES = "REPORTED,VERIFIED,DISPUTED";
    static final int MAX_ROUTE_POINTS = 5000;
    private static final Set<String> STRUCTURAL_FIELDS = Set.of("type", "location", "severity");
    static final int MAX_ROUTE_HAZARDS = 1000;
    static final double MAX_ROUTE_CORRIDOR_METERS = 200;

    private final HazardRepository hazardRepository;
    private final HazardConfirmationRepository confirmationRepository;
    private final ResolutionVoteRepository resolutionVoteRepository;
    private final HazardAuditLogRepository auditLogRepository;
    private final HazardSubmissionRepository submissionRepository;
    private final UserRepository userRepository;
    private final HazardAuditService audit;
    private final HazardEventProducer eventProducer;
    private final HazardClassifier classifier;
    private final HazardLifecycle lifecycle;
    private final ExpiryPolicy expiryPolicy;
    private final ReputationService reputationService;
    private final CoverageArea coverageArea;
    private final ImageUploadService imageUploadService;
    private final int resolutionThreshold;
    private final double routeCorridorMeters;

    public HazardService(HazardRepository hazardRepository,
                         HazardConfirmationRepository confirmationRepository,
                         ResolutionVoteRepository resolutionVoteRepository,
                         HazardAuditLogRepository auditLogRepository,
                         HazardSubmissionRepository submissionRepository,
                         UserRepository userRepository,
                         HazardAuditService audit,
                         HazardEventProducer eventProducer,
                         HazardClassifier classifier,
                         HazardLifecycle lifecycle,
                         ExpiryPolicy expiryPolicy,
                         ReputationService reputationService,
                         CoverageArea coverageArea,
                         ImageUploadService imageUploadService,
                         @Value("${saferoute.hazard.resolution-threshold}") int resolutionThreshold,
                         @Value("${saferoute.notification.route-corridor-meters}") double routeCorridorMeters) {
        this.hazardRepository = hazardRepository;
        this.confirmationRepository = confirmationRepository;
        this.resolutionVoteRepository = resolutionVoteRepository;
        this.auditLogRepository = auditLogRepository;
        this.submissionRepository = submissionRepository;
        this.userRepository = userRepository;
        this.audit = audit;
        this.eventProducer = eventProducer;
        this.classifier = classifier;
        this.lifecycle = lifecycle;
        this.expiryPolicy = expiryPolicy;
        this.reputationService = reputationService;
        this.coverageArea = coverageArea;
        this.imageUploadService = imageUploadService;
        this.resolutionThreshold = resolutionThreshold;
        this.routeCorridorMeters = routeCorridorMeters;
    }

    // ------------------------------------------------------------------ queries

    public List<HazardResponse> findNearby(double lat, double lon, Double radiusMeters, String types,
                                           String statuses, Integer limit) {
        requireCoordinates(lat, lon);
        double radius = radiusMeters != null ? radiusMeters : DEFAULT_RADIUS_METERS;
        if (radius < MIN_RADIUS_METERS || radius > MAX_RADIUS_METERS) {
            throw badRequest("radiusMeters must be between " + (int) MIN_RADIUS_METERS + " and " + (int) MAX_RADIUS_METERS);
        }
        return hazardRepository.findNearby(lat, lon, radius, parseTypes(types), parseStatuses(statuses), parseLimit(limit))
                .stream().map(HazardResponse::from).toList();
    }

    /** A query result plus whether the limit cut it short (more matching hazards exist). */
    public record HazardPage(List<HazardResponse> hazards, boolean truncated) {
    }

    public HazardPage findInBbox(double minLat, double minLon, double maxLat, double maxLon,
                                 String types, String statuses, Integer limit) {
        requireCoordinates(minLat, minLon);
        requireCoordinates(maxLat, maxLon);
        if (minLat >= maxLat || minLon >= maxLon) {
            throw badRequest("Bounding box must satisfy minLat < maxLat and minLon < maxLon");
        }
        if (maxLat - minLat > MAX_BBOX_SPAN_DEGREES || maxLon - minLon > MAX_BBOX_SPAN_DEGREES) {
            throw badRequest("Bounding box is too large (max " + MAX_BBOX_SPAN_DEGREES + "° per side); zoom in");
        }
        int max = parseLimit(limit);
        List<Hazard> found = hazardRepository.findInBbox(minLat, minLon, maxLat, maxLon, parseTypes(types), parseStatuses(statuses), max + 1);
        boolean truncated = found.size() > max;
        return new HazardPage(found.stream().limit(max).map(HazardResponse::from).toList(), truncated);
    }

    /**
     * Every active hazard within the corridor of any of the given routes — the complete input a
     * route assessment needs. Unlike the viewport queries this is not ordered by recency and cut
     * short: it returns everything up to {@link #MAX_ROUTE_HAZARDS} and says so if there were more.
     * Points outside the pilot coverage area are reported, because the absence of reports there
     * means "not tracked", not "no hazards".
     */
    public RouteHazardsResponse findAlongRoutes(RouteHazardsRequest request) {
        List<List<double[]>> routes = request.routes();
        int points = 0;
        boolean leavesCoverage = false;
        StringBuilder wkt = new StringBuilder("MULTILINESTRING(");
        for (int r = 0; r < routes.size(); r++) {
            List<double[]> route = routes.get(r);
            if (route == null || route.size() < 2) throw badRequest("Each route needs at least 2 points");
            if (r > 0) wkt.append(',');
            wkt.append('(');
            for (int i = 0; i < route.size(); i++) {
                double[] p = route.get(i);
                if (p == null || p.length != 2) throw badRequest("Route points must be [latitude, longitude]");
                requireCoordinates(p[0], p[1]);
                if (coverageArea.isEnabled() && !coverageArea.contains(p[0], p[1])) leavesCoverage = true;
                if (i > 0) wkt.append(',');
                wkt.append(String.format(Locale.ROOT, "%.7f %.7f", p[1], p[0]));
            }
            wkt.append(')');
            points += route.size();
        }
        wkt.append(')');
        if (points > MAX_ROUTE_POINTS) throw badRequest("Routes may have at most " + MAX_ROUTE_POINTS + " points in total");
        double corridor = request.corridorMeters() != null ? request.corridorMeters() : routeCorridorMeters;
        if (corridor < 1 || corridor > MAX_ROUTE_CORRIDOR_METERS) {
            throw badRequest("corridorMeters must be between 1 and " + (int) MAX_ROUTE_CORRIDOR_METERS);
        }
        List<Hazard> found = hazardRepository.findAlongLines(wkt.toString(), corridor, MAX_ROUTE_HAZARDS + 1);
        boolean truncated = found.size() > MAX_ROUTE_HAZARDS;
        return new RouteHazardsResponse(found.stream().limit(MAX_ROUTE_HAZARDS).map(HazardResponse::from).toList(),
                !truncated && !leavesCoverage, truncated, leavesCoverage, corridor);
    }

    public HazardDetailResponse getDetail(UUID id, AuthenticatedUser viewer) {
        Hazard hazard = requireHazard(id);
        TrustLevel reporterTrust = userRepository.findById(hazard.getReporterId())
                .map(u -> u.trustLevel()).orElse(TrustLevel.NEW_REPORTER);
        boolean isReporter = hazard.getReporterId().equals(viewer.id());
        ConfirmationAction myConfirmation = confirmationRepository.findByHazardIdAndUserId(id, viewer.id())
                .map(HazardConfirmation::getAction).orElse(null);
        ResolutionAction myVote = resolutionVoteRepository.findByHazardIdAndUserId(id, viewer.id())
                .map(ResolutionVote::getAction).orElse(null);
        var community = new HazardDetailResponse.Community(
                hazard.getConfirmationCount(), hazard.getDisputeCount(),
                resolutionVoteRepository.countByHazardIdAndAction(id, ResolutionAction.NO_LONGER_PRESENT),
                resolutionVoteRepository.countByHazardIdAndAction(id, ResolutionAction.STILL_PRESENT),
                resolutionThreshold);
        var viewerInfo = new HazardDetailResponse.Viewer(isReporter, myConfirmation, myVote,
                isReporter || viewer.canModerate(), viewer.canModerate());
        boolean expiringSoon = hazard.getStatus().isActive()
                && expiryPolicy.isExpiringSoon(hazard.getType(), hazard.getExpiresAt(), Instant.now());
        return new HazardDetailResponse(HazardResponse.from(hazard), reporterTrust, viewerInfo, community, expiringSoon);
    }

    public List<HazardTimelineEntry> getTimeline(UUID id) {
        Hazard hazard = requireHazard(id);
        return auditLogRepository.findByHazardIdOrderByCreatedAtAsc(id).stream()
                .map(e -> new HazardTimelineEntry(e.getId(), e.getAction(), e.getFieldName(), e.getOldValue(),
                        e.getNewValue(), e.getNote(), actorRole(e, hazard), e.getCreatedAt()))
                .toList();
    }

    public PageResponse<MyReportResponse> myReports(UUID userId, int page, int size) {
        Page<HazardSubmission> submissions = submissionRepository.findByReporterIdOrderByCreatedAtDesc(userId, PageRequest.of(page, size));
        Set<UUID> hazardIds = submissions.stream().map(HazardSubmission::getCanonicalHazardId)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        Map<UUID, Hazard> hazards = hazardRepository.findByIdIn(hazardIds).stream()
                .collect(Collectors.toMap(Hazard::getId, Function.identity()));
        List<MyReportResponse> items = submissions.stream().map(s -> {
            Hazard h = s.getCanonicalHazardId() != null ? hazards.get(s.getCanonicalHazardId()) : null;
            return new MyReportResponse(HazardSubmissionResponse.from(s), h != null ? HazardResponse.from(h) : null,
                    s.getProcessingStatus() == SubmissionStatus.MERGED);
        }).toList();
        return PageResponse.of(items, page, size, submissions.getTotalElements());
    }

    public PageResponse<HazardResponse> moderationQueue(String statuses, int page, int size) {
        String statusFilter = parseStatuses(statuses);
        List<HazardResponse> items = hazardRepository.findModerationQueue(statusFilter, size, page * size)
                .stream().map(HazardResponse::from).toList();
        return PageResponse.of(items, page, size, hazardRepository.countByStatuses(statusFilter));
    }

    // ------------------------------------------------------------------ community commands (async)

    @Transactional
    public CommandAccepted setConfirmation(UUID hazardId, UUID userId, ConfirmationAction action) {
        Hazard hazard = requireActive(hazardId);
        if (hazard.getReporterId().equals(userId)) {
            throw new ApiException(HttpStatus.CONFLICT, "SELF_CONFIRMATION_NOT_ALLOWED",
                    "You cannot verify or dispute your own hazard report.");
        }
        eventProducer.publishVerified(new HazardVerifiedEvent(
                EventMetadata.create(KafkaTopics.HAZARD_VERIFIED), hazardId, userId, action, hazard.getContentRevision()));
        return CommandAccepted.queued(hazardId, action);
    }

    @Transactional
    public CommandAccepted requestResolution(UUID hazardId, UUID userId, ResolutionAction action) {
        Hazard hazard = requireActive(hazardId);
        eventProducer.publishResolutionRequested(new ResolutionRequestedEvent(
                EventMetadata.create(KafkaTopics.HAZARD_RESOLUTION_REQUESTED), hazardId, userId, action,
                hazard.getContentRevision()));
        return CommandAccepted.queued(hazardId, action);
    }

    // ------------------------------------------------------------------ edits (sync)

    @Transactional
    public HazardResponse update(UUID hazardId, AuthenticatedUser actor, UpdateHazardRequest request) {
        Hazard hazard = requireHazardForUpdate(hazardId);
        boolean isReporter = hazard.getReporterId().equals(actor.id());
        boolean isModerator = actor.canModerate();
        if (!isReporter && !isModerator) {
            throw new ApiException(HttpStatus.FORBIDDEN, "NOT_REPORTER", "Only the reporter or a moderator can edit this hazard");
        }
        if (!isModerator && !hazard.getStatus().isActive()) {
            throw new ApiException(HttpStatus.CONFLICT, "HAZARD_NOT_ACTIVE", "This hazard is " + hazard.getStatus() + " and can no longer be edited");
        }
        boolean structural = request.type() != null || request.latitude() != null || request.longitude() != null
                || request.severityAnswer() != null;
        // Any community opinion — even a single VERIFY that left the hazard REPORTED — assessed the
        // current content, so the reporter may no longer change what it describes.
        boolean hasOpinions = hazard.getConfirmationCount() > 0 || hazard.getDisputeCount() > 0
                || confirmationRepository.existsByHazardId(hazardId) || resolutionVoteRepository.existsByHazardId(hazardId);
        if (structural && !isModerator && (hazard.getStatus() != HazardStatus.REPORTED || hasOpinions)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "EDIT_LOCKED",
                    "Type, location and severity can't be changed after the community has confirmed, disputed or voted on the report");
        }
        if ((request.latitude() == null) != (request.longitude() == null)) {
            throw badRequest("latitude and longitude must be provided together");
        }

        List<String> changed = new ArrayList<>();
        if (request.description() != null && !request.description().equals(hazard.getDescription())) {
            String value = request.description().isBlank() ? null : request.description().trim();
            audit.record(hazardId, actor.id(), HazardAuditLog.Action.FIELD_EDITED, "description", hazard.getDescription(), value, null);
            hazard.setDescription(value);
            changed.add("description");
        }
        if (request.photoUrl() != null && !request.photoUrl().equals(hazard.getPhotoUrl())) {
            imageUploadService.requireOwnedUpload(request.photoUrl(), actor.id());
            imageUploadService.markAttached(request.photoUrl());
            audit.record(hazardId, actor.id(), HazardAuditLog.Action.FIELD_EDITED, "photoUrl", hazard.getPhotoUrl(), request.photoUrl(), null);
            hazard.setPhotoUrl(request.photoUrl());
            changed.add("photoUrl");
        }
        if (request.latitude() != null) {
            coverageArea.requireCovered(request.latitude(), request.longitude());
            double moved = GeoUtils.distanceMeters(hazard.latitude(), hazard.longitude(), request.latitude(), request.longitude());
            if (!isModerator && moved > REPORTER_MAX_MOVE_METERS) {
                throw new ApiException(HttpStatus.FORBIDDEN, "MOVE_TOO_FAR",
                        "Reporters can adjust the location by at most " + (int) REPORTER_MAX_MOVE_METERS + " m");
            }
            if (moved > 0.01) {
                audit.record(hazardId, actor.id(), HazardAuditLog.Action.FIELD_EDITED, "location",
                        hazard.latitude() + "," + hazard.longitude(), request.latitude() + "," + request.longitude(), null);
                hazard.setLocation(GeoUtils.point(request.latitude(), request.longitude()));
                changed.add("location");
            }
        }
        HazardType newType = request.type() != null ? request.type() : hazard.getType();
        String newAnswer = request.severityAnswer() != null ? request.severityAnswer()
                : request.type() != null && !classifier.isValidAnswer(newType, hazard.getSeverityAnswer()) ? null
                : hazard.getSeverityAnswer();
        if (!classifier.isValidAnswer(newType, newAnswer)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SEVERITY_ANSWER", "severityAnswer is not a valid option for " + newType);
        }
        if (newType != hazard.getType()) {
            audit.record(hazardId, actor.id(), HazardAuditLog.Action.FIELD_EDITED, "type", hazard.getType(), newType, null);
            hazard.setType(newType);
            changed.add("type");
            // Expiry follows the new type's lifetime from the last real sighting; an edit is not
            // itself fresh evidence. If that moment has passed, the next expiry sweep retires it.
            Instant expiresAt = expiryPolicy.expiryFrom(newType, hazard.getLastConfirmedAt());
            audit.record(hazardId, actor.id(), HazardAuditLog.Action.FIELD_EDITED, "expiresAt", hazard.getExpiresAt(), expiresAt,
                    "Recomputed for " + newType + " from the last confirmation");
            hazard.setExpiresAt(expiresAt);
        }
        if (!Objects.equals(newAnswer, hazard.getSeverityAnswer()) || changed.contains("type")) {
            Severity severity = classifier.classify(newType, newAnswer);
            if (severity != hazard.getSeverity()) {
                audit.record(hazardId, actor.id(), HazardAuditLog.Action.FIELD_EDITED, "severity", hazard.getSeverity(), severity, null);
            }
            hazard.setSeverityAnswer(newAnswer);
            hazard.setSeverity(severity);
            changed.add("severity");
        }
        if (changed.isEmpty()) return HazardResponse.from(hazard);

        if (changed.stream().anyMatch(STRUCTURAL_FIELDS::contains)) {
            // New content: commands accepted against the old content are dropped by the consumer,
            // and existing opinions keep the revision they assessed.
            hazard.setContentRevision(hazard.getContentRevision() + 1);
            if (hasOpinions) {
                audit.record(hazardId, actor.id(), HazardAuditLog.Action.FIELD_EDITED, "contentRevision",
                        hazard.getContentRevision() - 1, hazard.getContentRevision(),
                        "Moderator changed content after community opinions; those opinions assessed revision "
                                + (hazard.getContentRevision() - 1));
            }
        }
        hazard = hazardRepository.save(hazard);
        eventProducer.publishUpdated(hazard, HazardChange.EDITED, actor.id());
        return HazardResponse.from(hazard);
    }

    // ------------------------------------------------------------------ moderation

    @Transactional
    public CommandAccepted resolve(UUID hazardId, UUID moderatorId, String note) {
        Hazard hazard = requireActive(hazardId);
        eventProducer.publishResolved(new HazardResolvedEvent(
                EventMetadata.create(KafkaTopics.HAZARD_RESOLVED), hazardId, moderatorId,
                note != null && !note.isBlank() ? note : "Resolved by moderator", hazard.getContentRevision()));
        return new CommandAccepted(hazardId, "RESOLVE", "QUEUED");
    }

    @Transactional
    public HazardResponse reopen(UUID hazardId, UUID moderatorId, String note) {
        Hazard hazard = requireHazardForUpdate(hazardId);
        if (hazard.getStatus().isActive()) {
            throw new ApiException(HttpStatus.CONFLICT, "HAZARD_ALREADY_ACTIVE", "Hazard is already " + hazard.getStatus());
        }
        resolutionVoteRepository.deleteByHazardId(hazardId);
        HazardStatus oldStatus = hazard.getStatus();
        HazardStatus newStatus = lifecycle.evaluate(HazardStatus.REPORTED, hazard.getConfirmationCount(), hazard.getDisputeCount());
        Instant now = Instant.now();
        hazard.setStatus(newStatus);
        hazard.setResolvedAt(null);
        // A new lifecycle: votes and moderator commands accepted before the reopen no longer apply.
        hazard.setContentRevision(hazard.getContentRevision() + 1);
        hazard.setLastConfirmedAt(now);
        hazard.setExpiresAt(expiryPolicy.expiryFrom(hazard.getType(), now));
        audit.statusChanged(hazardId, moderatorId, oldStatus, newStatus, note);
        audit.record(hazardId, moderatorId, HazardAuditLog.Action.MODERATOR_REOPENED, note);
        hazard = hazardRepository.save(hazard);
        eventProducer.publishUpdated(hazard, HazardChange.REINSTATED, moderatorId);
        return HazardResponse.from(hazard);
    }

    /** Removes a false/spam report; the reporter loses reputation and correct disputers gain it. */
    @Transactional
    public HazardResponse remove(UUID hazardId, UUID moderatorId, String note) {
        Hazard hazard = requireHazardForUpdate(hazardId);
        if (hazard.getStatus() == HazardStatus.REMOVED) {
            throw new ApiException(HttpStatus.CONFLICT, "HAZARD_ALREADY_REMOVED", "Hazard was already removed");
        }
        HazardStatus oldStatus = hazard.getStatus();
        hazard.setStatus(HazardStatus.REMOVED);
        hazard.setResolvedAt(Instant.now());
        reputationService.onHazardRemovedAsFalse(hazard);
        audit.statusChanged(hazardId, moderatorId, oldStatus, HazardStatus.REMOVED, note);
        audit.record(hazardId, moderatorId, HazardAuditLog.Action.MODERATOR_REMOVED, note);
        hazard = hazardRepository.save(hazard);
        eventProducer.publishUpdated(hazard, HazardChange.REMOVED, moderatorId);
        return HazardResponse.from(hazard);
    }

    // ------------------------------------------------------------------ helpers

    private Hazard requireHazard(UUID id) {
        return hazardRepository.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HAZARD_NOT_FOUND", "Hazard not found: " + id));
    }

    private Hazard requireHazardForUpdate(UUID id) {
        return hazardRepository.findByIdForUpdate(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HAZARD_NOT_FOUND", "Hazard not found: " + id));
    }

    private Hazard requireActive(UUID id) {
        Hazard hazard = requireHazard(id);
        if (!hazard.getStatus().isActive()) {
            throw new ApiException(HttpStatus.CONFLICT, "HAZARD_NOT_ACTIVE", "This hazard is already " + hazard.getStatus());
        }
        return hazard;
    }

    private static String actorRole(HazardAuditLog entry, Hazard hazard) {
        if (entry.getAction().name().startsWith("MODERATOR_")) return "MODERATOR";
        if (entry.getActorId() == null) return "SYSTEM";
        if (entry.getActorId().equals(hazard.getReporterId())) return "REPORTER";
        return "COMMUNITY";
    }

    private static void requireCoordinates(double lat, double lon) {
        if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_COORDINATES",
                    "latitude must be within [-90, 90] and longitude within [-180, 180]");
        }
    }

    private static int parseLimit(Integer limit) {
        int value = limit != null ? limit : DEFAULT_LIMIT;
        if (value < 1 || value > MAX_LIMIT) throw badRequest("limit must be between 1 and " + MAX_LIMIT);
        return value;
    }

    static String parseTypes(String csv) {
        if (csv == null || csv.isBlank()) return null;
        return parseEnumCsv(csv, HazardType.class, "types");
    }

    static String parseStatuses(String csv) {
        if (csv == null || csv.isBlank()) return ACTIVE_STATUSES;
        return parseEnumCsv(csv, HazardStatus.class, "statuses");
    }

    private static <E extends Enum<E>> String parseEnumCsv(String csv, Class<E> type, String param) {
        try {
            return Arrays.stream(csv.split(","))
                    .map(String::trim).filter(s -> !s.isEmpty())
                    .map(s -> Enum.valueOf(type, s.toUpperCase()).name())
                    .distinct()
                    .collect(Collectors.joining(","));
        } catch (IllegalArgumentException e) {
            throw badRequest("Unknown value in " + param + "; allowed: " + Arrays.toString(type.getEnumConstants()));
        }
    }

    private static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
    }
}
