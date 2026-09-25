package com.saferoute.backend.push;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

/**
 * Sends alerts through Apple Push Notification service with token-based (.p8 key) authentication.
 *
 * <p>The provider token is an ES256 JWT that Apple accepts for up to an hour and rejects if it is
 * regenerated more often than every 20 minutes, so it is cached and refreshed after
 * {@link #TOKEN_TTL}. Needs a paid Apple Developer account; see {@code saferoute.push.apns} in
 * application.yml.
 */
@Component
@ConditionalOnProperty(name = "saferoute.push.apns.enabled", havingValue = "true")
public class ApnsPushSender implements PushSender {

    private static final Logger log = LoggerFactory.getLogger(ApnsPushSender.class);
    static final Duration TOKEN_TTL = Duration.ofMinutes(50);
    /** A hazard alert that could not be delivered within this long is no longer worth showing. */
    private static final Duration ALERT_EXPIRY = Duration.ofHours(1);
    private static final Set<String> INVALID_TOKEN_REASONS = Set.of("BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered");

    private final PrivateKey signingKey;
    private final String keyId;
    private final String teamId;
    private final String bundleId;
    private final URI baseUri;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    private String cachedToken;
    private Instant cachedTokenIssuedAt;

    @Autowired
    public ApnsPushSender(@Value("${saferoute.push.apns.private-key-path}") String privateKeyPath,
                          @Value("${saferoute.push.apns.key-id}") String keyId,
                          @Value("${saferoute.push.apns.team-id}") String teamId,
                          @Value("${saferoute.push.apns.bundle-id}") String bundleId,
                          @Value("${saferoute.push.apns.environment}") String environment,
                          ObjectMapper objectMapper) {
        this(loadKey(privateKeyPath), require(keyId, "key-id"), require(teamId, "team-id"), bundleId,
                baseUriFor(environment), objectMapper,
                HttpClient.newBuilder().version(HttpClient.Version.HTTP_2).connectTimeout(Duration.ofSeconds(10)).build());
    }

    ApnsPushSender(PrivateKey signingKey, String keyId, String teamId, String bundleId, URI baseUri,
                   ObjectMapper objectMapper, HttpClient httpClient) {
        this.signingKey = signingKey;
        this.keyId = keyId;
        this.teamId = teamId;
        this.bundleId = bundleId;
        this.baseUri = baseUri;
        this.objectMapper = objectMapper;
        this.httpClient = httpClient;
    }

    @Override
    public CompletableFuture<Result> send(String deviceToken, PushMessage message) {
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(baseUri.resolve("/3/device/" + deviceToken))
                    .timeout(Duration.ofSeconds(10))
                    .header("authorization", "bearer " + providerToken(Instant.now()))
                    .header("apns-topic", bundleId)
                    .header("apns-push-type", "alert")
                    .header("apns-priority", "10")
                    .header("apns-expiration", Long.toString(Instant.now().plus(ALERT_EXPIRY).getEpochSecond()))
                    // A Kafka redelivery of the same hazard replaces the alert instead of stacking a second one.
                    .header("apns-collapse-id", message.hazardId().toString())
                    .POST(HttpRequest.BodyPublishers.ofString(payload(message)))
                    .build();
        } catch (JsonProcessingException e) {
            log.error("Could not serialize APNs payload", e);
            return CompletableFuture.completedFuture(Result.FAILED);
        }
        return httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenApply(this::interpret)
                .exceptionally(e -> {
                    log.warn("APNs request failed: {}", e.getMessage());
                    return Result.FAILED;
                });
    }

    /** The JSON body Apple expects; built with Jackson so titles containing quotes stay valid JSON. */
    String payload(PushMessage message) throws JsonProcessingException {
        return objectMapper.writeValueAsString(Map.of(
                "aps", Map.of(
                        "alert", Map.of("title", message.title(), "body", message.body()),
                        "sound", "default",
                        "thread-id", "hazard-alerts"),
                "hazardId", message.hazardId().toString()));
    }

    synchronized String providerToken(Instant now) {
        if (cachedToken == null || cachedTokenIssuedAt.plus(TOKEN_TTL).isBefore(now)) {
            cachedToken = Jwts.builder()
                    .header().keyId(keyId).and()
                    .issuer(teamId)
                    .issuedAt(Date.from(now))
                    .signWith(signingKey, Jwts.SIG.ES256)
                    .compact();
            cachedTokenIssuedAt = now;
        }
        return cachedToken;
    }

    private synchronized void discardProviderToken() {
        cachedToken = null;
    }

    private Result interpret(HttpResponse<String> response) {
        int status = response.statusCode();
        if (status == 200) return Result.DELIVERED;
        String reason = reason(response.body());
        if (status == 410 || INVALID_TOKEN_REASONS.contains(reason)) return Result.INVALID_TOKEN;
        if ("ExpiredProviderToken".equals(reason) || "InvalidProviderToken".equals(reason)) discardProviderToken();
        log.warn("APNs rejected a notification: HTTP {} {}", status, reason);
        return Result.FAILED;
    }

    private String reason(String body) {
        try {
            JsonNode node = objectMapper.readTree(body);
            return node != null && node.hasNonNull("reason") ? node.get("reason").asText() : "";
        } catch (IOException e) {
            return "";
        }
    }

    static URI baseUriFor(String environment) {
        return switch (environment) {
            case "production" -> URI.create("https://api.push.apple.com");
            case "sandbox" -> URI.create("https://api.sandbox.push.apple.com");
            default -> throw new IllegalStateException("saferoute.push.apns.environment must be sandbox or production, not " + environment);
        };
    }

    /** Reads an Apple .p8 key (PKCS#8 PEM). */
    static PrivateKey loadKey(String path) {
        require(path, "private-key-path");
        try {
            String pem = Files.readString(Path.of(path));
            return parseKey(pem);
        } catch (IOException | GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalStateException("Could not read the APNs key at " + path, e);
        }
    }

    static PrivateKey parseKey(String pem) throws GeneralSecurityException {
        String base64 = pem.replaceAll("-----(BEGIN|END) PRIVATE KEY-----", "").replaceAll("\\s", "");
        return KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(base64)));
    }

    private static String require(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("saferoute.push.apns.enabled is true but saferoute.push.apns." + name + " is not set");
        }
        return value;
    }
}
