package com.saferoute.backend.event.consumer;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.saferoute.backend.event.EventContext;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.HazardChange;
import com.saferoute.backend.event.dto.HazardUpdatedEvent;
import com.saferoute.backend.event.dto.SubmissionProcessedEvent;
import com.saferoute.backend.metrics.SafeRouteMetrics;
import com.saferoute.backend.spatial.GeoUtils;
import com.saferoute.backend.submission.SubmissionStatus;
import com.saferoute.backend.websocket.HazardEventFrame;
import com.saferoute.backend.websocket.RouteCorridor;
import com.saferoute.backend.websocket.SubmissionProcessedFrame;
import com.saferoute.backend.websocket.WebSocketSessionRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;

import java.io.IOException;
import java.util.EnumSet;
import java.util.Set;

/**
 * The Notification module: turns hazard outcome events into WebSocket frames.
 *
 * <ul>
 *   <li>Map updates go to every session within {@code map-update-radius-meters} so visible map
 *       state stays live for every status change, not just new hazards.</li>
 *   <li>A frame is flagged {@code alert} only when it is worth interrupting the user: a hazard
 *       that is new or newly verified, of an enabled type, and on the commuter's route ahead of
 *       them (or, with no route, within their personal alert radius).</li>
 * </ul>
 */
@Component
public class NotificationConsumer {

    private static final Logger log = LoggerFactory.getLogger(NotificationConsumer.class);
    private static final String GROUP_ID = "notification-service-group";
    private static final Set<HazardChange> ALERTABLE = EnumSet.of(HazardChange.CREATED, HazardChange.VERIFIED);

    private final WebSocketSessionRegistry registry;
    private final ObjectMapper objectMapper;
    private final SafeRouteMetrics metrics;
    private final double mapUpdateRadiusMeters;
    private final double routeCorridorMeters;

    public NotificationConsumer(WebSocketSessionRegistry registry,
                                ObjectMapper objectMapper,
                                SafeRouteMetrics metrics,
                                @Value("${saferoute.notification.map-update-radius-meters}") double mapUpdateRadiusMeters,
                                @Value("${saferoute.notification.route-corridor-meters}") double routeCorridorMeters) {
        this.registry = registry;
        this.objectMapper = objectMapper;
        this.metrics = metrics;
        this.mapUpdateRadiusMeters = mapUpdateRadiusMeters;
        this.routeCorridorMeters = routeCorridorMeters;
    }

    @KafkaListener(topics = {KafkaTopics.HAZARD_CREATED, KafkaTopics.HAZARD_UPDATED}, groupId = GROUP_ID)
    public void onHazardChanged(HazardUpdatedEvent event) {
        try (var ignored = EventContext.enter(event.metadata())) {
            String frameType = frameType(event.change());
            int sent = 0, alerts = 0;
            for (WebSocketSessionRegistry.SessionInfo info : registry.activeSessions()) {
                if (!info.hasLocation()) continue;
                double distance = GeoUtils.distanceMeters(info.lat(), info.lon(), event.latitude(), event.longitude());

                boolean onRoute = false;
                Double distanceAhead = null;
                RouteCorridor route = info.route();
                if (route != null) {
                    RouteCorridor.Projection hazardPos = route.project(event.latitude(), event.longitude());
                    RouteCorridor.Projection userPos = route.project(info.lat(), info.lon());
                    double ahead = hazardPos.distanceAlongRouteMeters() - userPos.distanceAlongRouteMeters();
                    if (hazardPos.distanceFromRouteMeters() <= routeCorridorMeters && ahead >= 0) {
                        onRoute = true;
                        distanceAhead = ahead;
                    }
                }
                if (distance > mapUpdateRadiusMeters && !onRoute) continue;

                boolean relevant = route != null ? onRoute : distance <= info.preferences().radiusMeters();
                boolean alert = ALERTABLE.contains(event.change())
                        && info.preferences().enabledTypes().contains(event.type())
                        && relevant;

                send(info, new HazardEventFrame(frameType, event.change(), event.hazardId(), event.type(),
                        event.latitude(), event.longitude(), event.status(), event.severity(),
                        event.confirmationCount(), event.disputeCount(), distance, alert, onRoute, distanceAhead,
                        event.metadata().occurredAt()));
                metrics.recordNotificationLatency(event.metadata().occurredAt());
                sent++;
                if (alert) alerts++;
            }
            log.debug("{} for hazard {} delivered to {} session(s), {} alert(s)", frameType, event.hazardId(), sent, alerts);
        }
    }

    @KafkaListener(topics = KafkaTopics.SUBMISSION_PROCESSED, groupId = GROUP_ID)
    public void onSubmissionProcessed(SubmissionProcessedEvent event) {
        try (var ignored = EventContext.enter(event.metadata())) {
            String message = switch (event.status()) {
                case CREATED -> "Report published";
                case MERGED -> "Your report matched an existing hazard. Your confirmation was added to that report.";
                case FAILED -> event.failureReason();
                default -> null;
            };
            var frame = new SubmissionProcessedFrame(event.submissionId(), event.status(), event.hazardId(), message);
            for (WebSocketSessionRegistry.SessionInfo info : registry.sessionsFor(event.reporterUserId())) {
                send(info, frame);
            }
            if (event.status() != SubmissionStatus.QUEUED) {
                metrics.recordNotificationLatency(event.metadata().occurredAt());
            }
        }
    }

    static String frameType(HazardChange change) {
        return switch (change) {
            case CREATED -> "hazard_created";
            case VERIFIED -> "hazard_verified";
            case DISPUTED -> "hazard_disputed";
            case RESOLVED, REMOVED -> "hazard_resolved";
            case EXPIRED -> "hazard_expired";
            default -> "hazard_updated";
        };
    }

    private void send(WebSocketSessionRegistry.SessionInfo info, Object frame) {
        try {
            info.session().sendMessage(new TextMessage(objectMapper.writeValueAsString(frame)));
        } catch (JsonProcessingException e) {
            log.error("Could not serialize WebSocket frame", e);
        } catch (IOException | IllegalStateException e) {
            log.warn("Failed to send WebSocket frame to user {}: {}", info.userId(), e.getMessage());
        }
    }
}
