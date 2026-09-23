package com.saferoute.backend.websocket;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory registry of connected commuters: last-known location, active route and alert
 * preferences. Keyed by session id so one user may be connected from several devices.
 * Deliberately not persisted — only live connections matter for push.
 */
@Component
public class WebSocketSessionRegistry {

    private static final int SEND_TIME_LIMIT_MS = 5_000;
    private static final int BUFFER_SIZE_LIMIT = 256 * 1024;

    public record SessionInfo(UUID userId, WebSocketSession session, double lat, double lon,
                              RouteCorridor route, AlertPreferences preferences) {

        public boolean hasLocation() {
            return !Double.isNaN(lat);
        }
    }

    private final Map<String, SessionInfo> sessions = new ConcurrentHashMap<>();

    public WebSocketSessionRegistry(MeterRegistry meterRegistry) {
        Gauge.builder("saferoute.websocket.active_sessions", sessions, Map::size)
                .description("Currently connected WebSocket sessions")
                .register(meterRegistry);
    }

    public void register(UUID userId, WebSocketSession session, AlertPreferences preferences) {
        // The decorator serializes concurrent sends: several Kafka listener threads may push
        // to the same session at once, which a raw WebSocketSession does not allow.
        var safeSession = new ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, BUFFER_SIZE_LIMIT);
        sessions.put(session.getId(), new SessionInfo(userId, safeSession, Double.NaN, Double.NaN, null, preferences));
    }

    public void updateLocation(String sessionId, double lat, double lon) {
        sessions.computeIfPresent(sessionId, (id, s) -> new SessionInfo(s.userId(), s.session(), lat, lon, s.route(), s.preferences()));
    }

    public void updateRoute(String sessionId, RouteCorridor route) {
        sessions.computeIfPresent(sessionId, (id, s) -> new SessionInfo(s.userId(), s.session(), s.lat(), s.lon(), route, s.preferences()));
    }

    public void updatePreferences(UUID userId, AlertPreferences preferences) {
        sessions.replaceAll((id, s) -> s.userId().equals(userId)
                ? new SessionInfo(s.userId(), s.session(), s.lat(), s.lon(), s.route(), preferences)
                : s);
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
}
