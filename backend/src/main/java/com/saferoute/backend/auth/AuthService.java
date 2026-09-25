package com.saferoute.backend.auth;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.user.ModeratorBootstrap;
import com.saferoute.backend.user.Role;
import com.saferoute.backend.user.User;
import com.saferoute.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    static final Duration REUSE_GRACE = Duration.ofSeconds(30);

    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final ModeratorBootstrap moderatorBootstrap;
    private final Duration refreshTokenTtl;

    public AuthService(UserRepository userRepository,
                       RefreshTokenRepository refreshTokenRepository,
                       PasswordEncoder passwordEncoder,
                       JwtService jwtService,
                       ModeratorBootstrap moderatorBootstrap,
                       @Value("${saferoute.jwt.refresh-token-ttl}") Duration refreshTokenTtl) {
        this.userRepository = userRepository;
        this.refreshTokenRepository = refreshTokenRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.moderatorBootstrap = moderatorBootstrap;
        this.refreshTokenTtl = refreshTokenTtl;
    }

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        String email = request.email().trim().toLowerCase();
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "Email already registered");
        }
        User user = User.builder()
                .email(email)
                .passwordHash(passwordEncoder.encode(request.password()))
                .displayName(request.displayName().trim())
                .role(Role.USER)
                .build();
        // Flushed so the row exists for ModeratorBootstrap's role_grants insert (plain JDBC, FK to users).
        user = userRepository.saveAndFlush(user);
        moderatorBootstrap.onRegistered(user);
        return issueTokens(user);
    }

    /** Returns empty-handed (throws 401) on bad credentials; the caller counts the failure for rate limiting. */
    @Transactional
    public AuthResponse login(LoginRequest request) {
        User user = userRepository.findByEmailIgnoreCase(request.email().trim())
                .orElseThrow(AuthService::invalidCredentials);
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw invalidCredentials();
        }
        return issueTokens(user);
    }

    /**
     * Rotates the refresh token. The row is locked, so concurrent refreshes of one token serialize
     * and exactly one of them rotates it. Presenting an already-rotated token is treated as theft
     * (every session for that user is revoked) — except within {@link #REUSE_GRACE} of the
     * rotation, where it is almost certainly a benign duplicate request from the same client and
     * is simply refused.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public AuthResponse refresh(String presentedToken) {
        RefreshToken stored = refreshTokenRepository.findByTokenHashForUpdate(hash(presentedToken))
                .orElseThrow(AuthService::invalidRefreshToken);
        Instant now = Instant.now();
        if (stored.getRevokedAt() != null) {
            boolean justRotated = stored.getReplacedBy() != null && stored.getRevokedAt().isAfter(now.minus(REUSE_GRACE));
            if (stored.getReplacedBy() != null && !justRotated) {
                log.warn("Refresh token reuse detected for user {}; revoking all sessions", stored.getUserId());
                refreshTokenRepository.revokeAllForUser(stored.getUserId(), now);
            }
            throw invalidRefreshToken();
        }
        if (stored.getExpiresAt().isBefore(now)) {
            throw invalidRefreshToken();
        }
        User user = userRepository.findById(stored.getUserId()).orElseThrow(AuthService::invalidRefreshToken);
        AuthResponse response = issueTokens(user);
        RefreshToken replacement = refreshTokenRepository.findByTokenHash(hash(response.refreshToken())).orElseThrow();
        stored.setRevokedAt(now);
        stored.setReplacedBy(replacement.getId());
        return response;
    }

    @Transactional
    public void logout(String presentedToken) {
        refreshTokenRepository.findByTokenHash(hash(presentedToken)).ifPresent(token -> {
            if (token.getRevokedAt() == null) token.setRevokedAt(Instant.now());
        });
    }

    public MeResponse me(UUID userId) {
        return userRepository.findById(userId)
                .map(MeResponse::from)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Account no longer exists"));
    }

    private AuthResponse issueTokens(User user) {
        String accessToken = jwtService.generateToken(user.getId(), user.getEmail(), user.getRole());
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        String refreshToken = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        refreshTokenRepository.save(RefreshToken.builder()
                .userId(user.getId())
                .tokenHash(hash(refreshToken))
                .expiresAt(Instant.now().plus(refreshTokenTtl))
                .build());
        return new AuthResponse(accessToken, refreshToken, jwtService.expirationSeconds(),
                user.getId(), user.getEmail(), user.getDisplayName(), user.getRole());
    }

    static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static ApiException invalidCredentials() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    private static ApiException invalidRefreshToken() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Session expired. Please log in again.");
    }
}
