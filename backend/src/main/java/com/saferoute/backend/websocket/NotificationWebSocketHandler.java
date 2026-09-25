package com.saferoute.backend.websocket;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.saferoute.backend.user.NotificationPreferencesService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.time.Instant;
import java.util.UUID;

@Component
public class NotificationWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(NotificationWebSocketHandler.class);
    private static final int MAX_ROUTE_POINTS = 1000;

    private final WebSocketSessionRegistry registry;
    private final NotificationPreferencesService preferencesService;
    private final ObjectMapper objectMapper;

    public NotificationWebSocketHandler(WebSocketSessionRegistry registry,
                                        NotificationPreferencesService preferencesService,
                                        ObjectMapper objectMapper) {
        this.registry = registry;
        this.preferencesService = preferencesService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(@NonNull WebSocketSession session) {
        UUID userId = userId(session);
        session.setTextMessageSizeLimit(64 * 1024);
        registry.register(userId, session, preferencesService.alertPreferences(userId),
                (Instant) session.getAttributes().get("tokenExpiresAt"));
        log.info("WebSocket connected: user={} session={}", userId, session.getId());
    }

    @Override
    protected void handleTextMessage(@NonNull WebSocketSession session, @NonNull TextMessage message) {
        SubscribeFrame frame;
        try {
            frame = objectMapper.readValue(message.getPayload(), SubscribeFrame.class);
        } catch (JsonProcessingException e) {
            log.debug("Ignoring malformed frame from session {}", session.getId());
            return;
        }
        if ("subscribe".equals(frame.type()) && frame.lat() != null && frame.lon() != null
                && Math.abs(frame.lat()) <= 90 && Math.abs(frame.lon()) <= 180) {
            registry.updateLocation(session.getId(), frame.lat(), frame.lon());
        } else if ("route".equals(frame.type())) {
            registry.updateRoute(session.getId(), parseRoute(frame));
        }
    }

    @Override
    public void afterConnectionClosed(@NonNull WebSocketSession session, @NonNull CloseStatus status) {
        registry.unregister(session.getId());
    }

    private RouteCorridor parseRoute(SubscribeFrame frame) {
        if (frame.route() == null || frame.route().size() < 2 || frame.route().size() > MAX_ROUTE_POINTS) return null;
        for (double[] p : frame.route()) {
            if (p == null || p.length != 2 || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) return null;
        }
        return new RouteCorridor(frame.route());
    }

    private UUID userId(WebSocketSession session) {
        return (UUID) session.getAttributes().get("userId");
    }
}
