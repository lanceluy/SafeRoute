package com.saferoute.backend.websocket;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory registry of connected commuters: last-known location, active route and alert
 * preferences. Keyed by session id so one user may be connected from several devices.
 * Deliberately not persisted — only live connections matter for push.
 *
 * <p>A session lives no longer than the access token it was opened with: expired sessions are
 * closed (code 4001) and the client reconnects with a refreshed token, so a revoked or expired
 * credential can't keep receiving location-linked alerts. A location older than
 * {@link #LOCATION_MAX_AGE} is not used to decide alert relevance.
 */
@Component
public class WebSocketSessionRegistry {

    private static final Logger log = LoggerFactory.getLogger(WebSocketSessionRegistry.class);
    private static final int SEND_TIME_LIMIT_MS = 5_000;
    private static final int BUFFER_SIZE_LIMIT = 256 * 1024;
    public static final Duration LOCATION_MAX_AGE = Duration.ofMinutes(10);
    public static final CloseStatus TOKEN_EXPIRED = new CloseStatus(4001, "Access token expired; reconnect");

    public record SessionInfo(UUID userId, WebSocketSession session, double lat, double lon, Instant locationAt,
                              RouteCorridor route, AlertPreferences preferences, Instant expiresAt) {

        public boolean hasLocation() {
            return !Double.isNaN(lat);
        }

        /** True if the last location report is recent enough to decide whether an alert is relevant. */
        public boolean hasFreshLocation(Instant now) {
            return hasLocation() && locationAt != null && locationAt.isAfter(now.minus(LOCATION_MAX_AGE));
        }

        SessionInfo withLocation(double newLat, double newLon, Instant at) {
            return new SessionInfo(userId, session, newLat, newLon, at, route, preferences, expiresAt);
        }

        SessionInfo withRoute(RouteCorridor newRoute) {
            return new SessionInfo(userId, session, lat, lon, locationAt, newRoute, preferences, expiresAt);
        }

        SessionInfo withPreferences(AlertPreferences newPreferences) {
            return new SessionInfo(userId, session, lat, lon, locationAt, route, newPreferences, expiresAt);
        }
    }

    private final Map<String, SessionInfo> sessions = new ConcurrentHashMap<>();

    public WebSocketSessionRegistry(MeterRegistry meterRegistry) {
        Gauge.builder("saferoute.websocket.active_sessions", sessions, Map::size)
                .description("Currently connected WebSocket sessions")
                .register(meterRegistry);
    }

    public void register(UUID userId, WebSocketSession session, AlertPreferences preferences, Instant expiresAt) {
        // The decorator serializes concurrent sends: several Kafka listener threads may push
        // to the same session at once, which a raw WebSocketSession does not allow.
        var safeSession = new ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, BUFFER_SIZE_LIMIT);
        sessions.put(session.getId(), new SessionInfo(userId, safeSession, Double.NaN, Double.NaN, null, null,
                preferences, expiresAt));
    }

    public void updateLocation(String sessionId, double lat, double lon) {
        Instant now = Instant.now();
        sessions.computeIfPresent(sessionId, (id, s) -> s.withLocation(lat, lon, now));
    }

    public void updateRoute(String sessionId, RouteCorridor route) {
        sessions.computeIfPresent(sessionId, (id, s) -> s.withRoute(route));
    }

    public void updatePreferences(UUID userId, AlertPreferences preferences) {
        sessions.replaceAll((id, s) -> s.userId().equals(userId) ? s.withPreferences(preferences) : s);
    }

    public void unregister(String sessionId) {
        sessions.remove(sessionId);
    }

    public Collection<SessionInfo> activeSessions() {
        return sessions.values();
    }

    public List<SessionInfo> sessionsFor(UUID userId) {
        return sessions.values().stream().filter(s -> s.userId().equals(userId)).toList();
    }

    @Scheduled(fixedDelayString = "PT30S", initialDelayString = "PT30S")
    public void closeExpiredSessions() {
        Instant now = Instant.now();
        for (SessionInfo info : sessions.values()) {
            if (info.expiresAt() != null && info.expiresAt().isBefore(now)) {
                sessions.remove(info.session().getId());
                try {
                    info.session().close(TOKEN_EXPIRED);
                } catch (IOException | IllegalStateException e) {
                    log.debug("Closing expired session {} failed: {}", info.session().getId(), e.getMessage());
                }
            }
        }
    }
}
