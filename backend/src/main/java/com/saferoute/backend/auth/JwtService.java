package com.saferoute.backend.auth;

import com.saferoute.backend.user.Role;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

/**
 * Issues short-lived access tokens; long-lived sessions use rotated refresh tokens ({@link AuthService}).
 *
 * <p>Tokens are trusted on signature alone (the role claim included), so the signing key must be
 * secret. Startup fails without {@code JWT_SECRET}, and the published development key is refused
 * unless {@code saferoute.jwt.allow-dev-secret} is set (the dev, test and benchmark profiles).
 */
@Service
public class JwtService {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);
    /** Public, in the repository: acceptable only for local development. */
    static final String DEV_SECRET = "dev-only-insecure-secret-change-me-please-must-be-32-bytes-min";
    private static final int MIN_SECRET_BYTES = 32;

    private final SecretKey key;
    private final long expirationMs;

    public JwtService(@Value("${saferoute.jwt.secret:}") String secret,
                      @Value("${saferoute.jwt.allow-dev-secret:false}") boolean allowDevSecret,
                      @Value("${saferoute.jwt.access-token-expiration-ms}") long expirationMs) {
        this.key = Keys.hmacShaKeyFor(resolveSecret(secret, allowDevSecret).getBytes(StandardCharsets.UTF_8));
        this.expirationMs = expirationMs;
    }

    static String resolveSecret(String configured, boolean allowDevSecret) {
        String secret = configured == null ? "" : configured.trim();
        if (secret.isEmpty()) {
            if (!allowDevSecret) {
                throw new IllegalStateException("JWT_SECRET is not set. Generate one (e.g. `openssl rand -base64 48`) "
                        + "or run locally with SPRING_PROFILES_ACTIVE=dev.");
            }
            log.warn("JWT_SECRET is not set; using the public development key. Never do this on a shared deployment.");
            return DEV_SECRET;
        }
        if (secret.equals(DEV_SECRET) && !allowDevSecret) {
            throw new IllegalStateException("JWT_SECRET is the public development key. Set a private secret.");
        }
        if (secret.getBytes(StandardCharsets.UTF_8).length < MIN_SECRET_BYTES) {
            throw new IllegalStateException("JWT_SECRET must be at least " + MIN_SECRET_BYTES + " bytes.");
        }
        return secret;
    }

    public String generateToken(UUID userId, String email, Role role) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + expirationMs);
        return Jwts.builder()
                .subject(userId.toString())
                .claim("email", email)
                .claim("role", role.name())
                .issuedAt(now)
                .expiration(expiry)
                .signWith(key)
                .compact();
    }

    public long expirationSeconds() {
        return expirationMs / 1000;
    }

    public Claims parseClaims(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public AuthenticatedUser parsePrincipal(String token) {
        Claims claims = parseClaims(token);
        String role = claims.get("role", String.class);
        return new AuthenticatedUser(
                UUID.fromString(claims.getSubject()),
                claims.get("email", String.class),
                role != null ? Role.valueOf(role) : Role.USER);
    }
}
