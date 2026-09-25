package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.support.IntegrationTestBase;
import com.saferoute.backend.user.ModeratorBootstrap;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

class AuthIntegrationTest extends IntegrationTestBase {

    @Autowired
    ModeratorBootstrap moderatorBootstrap;

    @Value("${saferoute.jwt.secret}")
    String jwtSecret;

    @Test
    void registerReturnsAccessAndRefreshTokens() throws Exception {
        TestUser user = registerUser();
        assertThat(user.token()).isNotBlank();
        assertThat(user.refreshToken()).isNotBlank();

        JsonNode me = json(mvc.perform(get("/api/auth/me").with(bearer(user))).andReturn(), 200);
        assertThat(me.get("role").asText()).isEqualTo("USER");
        assertThat(me.get("trustLevel").asText()).isEqualTo("NEW_REPORTER");
    }

    @Test
    void duplicateEmailIsRejected() throws Exception {
        TestUser user = registerUser();
        JsonNode body = json(mvc.perform(post("/api/auth/register").with(uniqueIp()).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("email", user.email().toUpperCase(), "password", "password123", "displayName", "Dup"))))
                .andReturn(), 409);
        assertThat(body.get("error").asText()).isEqualTo("EMAIL_TAKEN");
    }

    @Test
    void loginAndWrongPassword() throws Exception {
        TestUser user = registerUser();
        json(mvc.perform(post("/api/auth/login").with(uniqueIp()).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("email", user.email(), "password", user.password())))).andReturn(), 200);
        JsonNode wrong = json(mvc.perform(post("/api/auth/login").with(uniqueIp()).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("email", user.email(), "password", "nope-nope")))).andReturn(), 401);
        assertThat(wrong.get("error").asText()).isEqualTo("INVALID_CREDENTIALS");
    }

    @Test
    void missingInvalidAndExpiredTokensAre401() throws Exception {
        String nearby = "/api/hazards/nearby?lat=" + BASE_LAT + "&lon=" + BASE_LON;
        json(mvc.perform(get(nearby)).andReturn(), 401);
        json(mvc.perform(get(nearby).with(bearer("not-a-jwt"))).andReturn(), 401);

        String expired = Jwts.builder()
                .subject(java.util.UUID.randomUUID().toString())
                .claim("email", "x@test.local").claim("role", "USER")
                .issuedAt(new Date(System.currentTimeMillis() - 7_200_000))
                .expiration(new Date(System.currentTimeMillis() - 3_600_000))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact();
        JsonNode body = json(mvc.perform(get(nearby).with(bearer(expired))).andReturn(), 401);
        assertThat(body.get("error").asText()).isEqualTo("UNAUTHORIZED");
    }

    @Test
    void refreshRotatesAndDetectsReuse() throws Exception {
        TestUser user = registerUser();
        JsonNode refreshed = json(mvc.perform(post("/api/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("refreshToken", user.refreshToken())))).andReturn(), 200);
        String second = refreshed.get("refreshToken").asText();
        assertThat(second).isNotEqualTo(user.refreshToken());

        // A replay within seconds is almost certainly the same client racing itself: refused, but
        // the session it just rotated to survives.
        json(mvc.perform(post("/api/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("refreshToken", user.refreshToken())))).andReturn(), 401);

        // A replay long after rotation is treated as theft: it fails and revokes the newer token too.
        jdbc.update("UPDATE refresh_tokens SET revoked_at = now() - interval '1 hour' WHERE revoked_at IS NOT NULL AND user_id = ?",
                user.id());
        json(mvc.perform(post("/api/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("refreshToken", user.refreshToken())))).andReturn(), 401);
        json(mvc.perform(post("/api/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("refreshToken", second)))).andReturn(), 401);
    }

    @Test
    void logoutRevokesRefreshToken() throws Exception {
        TestUser user = registerUser();
        expectStatus(mvc.perform(post("/api/auth/logout").contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("refreshToken", user.refreshToken())))).andReturn(), 204);
        json(mvc.perform(post("/api/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("refreshToken", user.refreshToken())))).andReturn(), 401);
    }

    @Test
    void repeatedFailedLoginsFromOneIpAreRateLimited() throws Exception {
        TestUser user = registerUser();
        String attackerIp = "203.0.113.77";
        for (int i = 0; i < 5; i++) {
            json(mvc.perform(post("/api/auth/login").with(ip(attackerIp)).contentType(MediaType.APPLICATION_JSON)
                    .content(toJson(Map.of("email", user.email(), "password", "wrong-" + i)))).andReturn(), 401);
        }
        var result = mvc.perform(post("/api/auth/login").with(ip(attackerIp)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("email", user.email(), "password", user.password())))).andReturn();
        JsonNode body = json(result, 429);
        assertThat(body.get("error").asText()).isEqualTo("RATE_LIMITED");
        assertThat(result.getResponse().getHeader("Retry-After")).isNotBlank();
    }

    @Test
    void registrationIsRateLimitedPerIp() throws Exception {
        String ip = "198.51.100.9";
        for (int i = 0; i < 3; i++) {
            json(mvc.perform(post("/api/auth/register").with(ip(ip)).contentType(MediaType.APPLICATION_JSON)
                    .content(toJson(Map.of("email", "r" + i + "-" + System.nanoTime() + "@test.local",
                            "password", "password123", "displayName", "R")))).andReturn(), 201);
        }
        json(mvc.perform(post("/api/auth/register").with(ip(ip)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("email", "r4-" + System.nanoTime() + "@test.local",
                        "password", "password123", "displayName", "R")))).andReturn(), 429);
    }

    @Test
    void registeringAnAllowlistedButUnverifiedEmailDoesNotGrantModerator() throws Exception {
        // application-test.yml allowlists this address but leaves trust-unverified-emails off.
        JsonNode body = json(mvc.perform(post("/api/auth/register").with(uniqueIp()).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("email", "allowlisted-moderator@test.local", "password", "password123",
                        "displayName", "Impostor")))).andReturn(), 201);

        assertThat(body.get("role").asText()).isEqualTo("USER");
        Integer grants = jdbc.queryForObject("SELECT count(*) FROM role_grants WHERE user_id = ?::uuid",
                Integer.class, body.get("userId").asText());
        assertThat(grants).isZero();
    }

    @Test
    void registeringAnAllowlistedEmailWithTrustEnabledGrantsModerator() throws Exception {
        // The dev profile's path (trust-unverified-emails: true). Toggled on the shared bean rather
        // than in a separate context, which would split the Kafka consumer groups.
        ReflectionTestUtils.setField(moderatorBootstrap, "trustUnverifiedEmails", true);
        try {
            JsonNode body = json(mvc.perform(post("/api/auth/register").with(uniqueIp()).contentType(MediaType.APPLICATION_JSON)
                    .content(toJson(Map.of("email", "promoted-moderator@test.local", "password", "password123",
                            "displayName", "Dev Moderator")))).andReturn(), 201);

            assertThat(body.get("role").asText()).isEqualTo("MODERATOR");
            Integer grants = jdbc.queryForObject("SELECT count(*) FROM role_grants WHERE user_id = ?::uuid",
                    Integer.class, body.get("userId").asText());
            assertThat(grants).isEqualTo(1);
        } finally {
            ReflectionTestUtils.setField(moderatorBootstrap, "trustUnverifiedEmails", false);
        }
    }

    @Test
    void concurrentRefreshesOfOneTokenRotateItExactlyOnce() throws Exception {
        TestUser user = registerUser();
        String request = toJson(Map.of("refreshToken", user.refreshToken()));
        var pool = java.util.concurrent.Executors.newFixedThreadPool(4);
        try {
            var start = new java.util.concurrent.CountDownLatch(1);
            java.util.List<java.util.concurrent.Future<Integer>> results = new java.util.ArrayList<>();
            for (int i = 0; i < 4; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return mvc.perform(post("/api/auth/refresh").contentType(MediaType.APPLICATION_JSON).content(request))
                            .andReturn().getResponse().getStatus();
                }));
            }
            start.countDown();
            int ok = 0;
            for (var result : results) if (result.get() == 200) ok++;
            assertThat(ok).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
        Integer live = jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL", Integer.class, user.id());
        assertThat(live).isEqualTo(1);
    }
}
