package com.saferoute.backend.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.kafka.KafkaContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Predicate;

import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * Real PostGIS + real Kafka (Testcontainers), shared by every integration test class through
 * Spring's context cache. Uses the same images as docker-compose.yml.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(RecordingPushSender.class)
public abstract class IntegrationTestBase {

    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            DockerImageName.parse("postgis/postgis:16-3.4").asCompatibleSubstituteFor("postgres"));
    static final KafkaContainer KAFKA = new KafkaContainer(DockerImageName.parse("apache/kafka:3.8.0"));

    static {
        POSTGRES.start();
        KAFKA.start();
    }

    @DynamicPropertySource
    static void containerProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.kafka.bootstrap-servers", KAFKA::getBootstrapServers);
    }

    /** Makati CBD, inside the Metro Manila coverage area. */
    protected static final double BASE_LAT = 14.5547;
    protected static final double BASE_LON = 121.0244;
    private static final AtomicInteger LOCATION_SEQ = new AtomicInteger();
    private static final AtomicInteger IP_SEQ = new AtomicInteger(1);

    protected record TestUser(UUID id, String email, String password, String token, String refreshToken) {
    }

    public record Location(double lat, double lon) {
        public Location offsetMeters(double north, double east) {
            return new Location(lat + north / 111_320.0, lon + east / (111_320.0 * Math.cos(Math.toRadians(lat))));
        }
    }

    @Autowired protected MockMvc mvc;
    @Autowired protected ObjectMapper objectMapper;
    @Autowired protected JdbcTemplate jdbc;

    /** A fresh spot ~250 m from any other test's, so dedup never merges across tests. */
    protected Location freshLocation() {
        int n = LOCATION_SEQ.incrementAndGet();
        return new Location(BASE_LAT + (n % 50) * 0.00225, BASE_LON + (n / 50) * 0.00225);
    }

    /** Each registration comes from its own fake IP so the 3/hour/IP register limit doesn't trip. */
    protected RequestPostProcessor uniqueIp() {
        String ip = "10.0." + (IP_SEQ.get() / 250) + "." + (IP_SEQ.getAndIncrement() % 250 + 1);
        return request -> {
            request.setRemoteAddr(ip);
            return request;
        };
    }

    protected RequestPostProcessor ip(String ip) {
        return request -> {
            request.setRemoteAddr(ip);
            return request;
        };
    }

    protected RequestPostProcessor bearer(TestUser user) {
        return bearer(user.token());
    }

    protected RequestPostProcessor bearer(String token) {
        return request -> {
            request.addHeader("Authorization", "Bearer " + token);
            return request;
        };
    }

    protected TestUser registerUser() throws Exception {
        String email = "user-" + UUID.randomUUID() + "@test.local";
        JsonNode body = json(mvc.perform(post("/api/auth/register").with(uniqueIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(toJson(Map.of("email", email, "password", "password123", "displayName", "Tester"))))
                .andReturn(), 201);
        return new TestUser(UUID.fromString(body.get("userId").asText()), email, "password123",
                body.get("token").asText(), body.get("refreshToken").asText());
    }

    protected TestUser registerModerator() throws Exception {
        TestUser user = registerUser();
        jdbc.update("UPDATE users SET role = 'MODERATOR' WHERE id = ?", user.id());
        JsonNode body = json(mvc.perform(post("/api/auth/login").with(uniqueIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(toJson(Map.of("email", user.email(), "password", user.password()))))
                .andReturn(), 200);
        return new TestUser(user.id(), user.email(), user.password(), body.get("token").asText(), body.get("refreshToken").asText());
    }

    protected UUID submit(TestUser user, String type, Location at) throws Exception {
        return submit(user, Map.of("type", type, "latitude", at.lat(), "longitude", at.lon()));
    }

    protected UUID submit(TestUser user, Map<String, Object> body) throws Exception {
        JsonNode accepted = json(mvc.perform(post("/api/hazard-submissions").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(body))).andReturn(), 202);
        return UUID.fromString(accepted.get("submissionId").asText());
    }

    /** Waits for the Kafka consumer to finish a submission and returns the final submission JSON. */
    protected JsonNode awaitSubmission(TestUser user, UUID submissionId) {
        return awaitJson(get("/api/hazard-submissions/" + submissionId).with(bearer(user)),
                n -> !"QUEUED".equals(n.get("status").asText()));
    }

    protected UUID reportAndAwaitHazard(TestUser user, String type, Location at) throws Exception {
        JsonNode result = awaitSubmission(user, submit(user, type, at));
        return UUID.fromString(result.get("hazardId").asText());
    }

    protected JsonNode hazardDetail(TestUser viewer, UUID hazardId) throws Exception {
        return json(mvc.perform(get("/api/hazards/" + hazardId).with(bearer(viewer))).andReturn(), 200);
    }

    protected JsonNode awaitHazard(TestUser viewer, UUID hazardId, Predicate<JsonNode> condition) {
        return awaitJson(get("/api/hazards/" + hazardId).with(bearer(viewer)), n -> condition.test(n.get("hazard")))
                .get("hazard");
    }

    protected JsonNode awaitJson(MockHttpServletRequestBuilder request, Predicate<JsonNode> condition) {
        JsonNode[] holder = new JsonNode[1];
        await().atMost(Duration.ofSeconds(30)).pollInterval(Duration.ofMillis(200)).until(() -> {
            MvcResult result = mvc.perform(request).andReturn();
            if (result.getResponse().getStatus() != 200) return false;
            holder[0] = objectMapper.readTree(result.getResponse().getContentAsString());
            return condition.test(holder[0]);
        });
        return holder[0];
    }

    protected void confirm(TestUser user, UUID hazardId, String action) throws Exception {
        expectStatus(mvc.perform(put("/api/hazards/" + hazardId + "/confirmation").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("action", action)))).andReturn(), 202);
    }

    protected JsonNode json(MvcResult result, int expectedStatus) throws Exception {
        expectStatus(result, expectedStatus);
        String content = result.getResponse().getContentAsString();
        return content.isEmpty() ? null : objectMapper.readTree(content);
    }

    protected void expectStatus(MvcResult result, int expectedStatus) throws Exception {
        int actual = result.getResponse().getStatus();
        if (actual != expectedStatus) {
            throw new AssertionError("Expected HTTP " + expectedStatus + " but got " + actual + ": "
                    + result.getResponse().getContentAsString());
        }
    }

    protected String toJson(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }
}
