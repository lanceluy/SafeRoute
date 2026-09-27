package com.saferoute.backend.websocket;

import com.saferoute.backend.auth.AuthenticatedUser;
import com.saferoute.backend.auth.JwtService;
import io.jsonwebtoken.JwtException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Validates the JWT before the WebSocket upgrade completes, from the
 * {@code Authorization: Bearer <jwt>} handshake header or, for browsers (which can't set headers
 * on a WebSocket), the subprotocol list {@code Sec-WebSocket-Protocol: bearer, <jwt>}; the
 * handler then answers with the {@code bearer} subprotocol. The {@code ?token=} query parameter is
 * off by default because URLs end up in access logs; enable
 * {@code saferoute.websocket.allow-query-token} only for clients that cannot set headers.
 */
@Component
public class JwtHandshakeInterceptor implements HandshakeInterceptor {

    public static final String BEARER_PROTOCOL = "bearer";
    private static final Pattern TOKEN_PARAM = Pattern.compile("(?:^|[?&])token=([^&]+)");

    private final JwtService jwtService;
    private final boolean allowQueryToken;

    public JwtHandshakeInterceptor(JwtService jwtService,
                                   @Value("${saferoute.websocket.allow-query-token:false}") boolean allowQueryToken) {
        this.jwtService = jwtService;
        this.allowQueryToken = allowQueryToken;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        String token = extractToken(request);
        if (token == null) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        try {
            AuthenticatedUser principal = jwtService.parsePrincipal(token);
            attributes.put("userId", principal.id());
            attributes.put("canModerate", principal.canModerate());
            // The session is closed when this token expires (see WebSocketSessionRegistry).
            attributes.put("tokenExpiresAt", jwtService.parseClaims(token).getExpiration().toInstant());
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // no-op
    }

    private String extractToken(ServerHttpRequest request) {
        String header = request.getHeaders().getFirst("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        List<String> protocols = request.getHeaders().get("Sec-WebSocket-Protocol");
        if (protocols != null) {
            List<String> values = protocols.stream().flatMap(p -> Arrays.stream(p.split(","))).map(String::trim).toList();
            int i = values.indexOf(BEARER_PROTOCOL);
            if (i >= 0 && i + 1 < values.size()) {
                return values.get(i + 1);
            }
        }
        String query = request.getURI().getQuery();
        if (allowQueryToken && query != null) {
            Matcher matcher = TOKEN_PARAM.matcher(query);
            if (matcher.find()) {
                return matcher.group(1);
            }
        }
        return null;
    }
}
