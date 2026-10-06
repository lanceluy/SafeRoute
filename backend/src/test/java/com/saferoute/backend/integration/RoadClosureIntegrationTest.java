package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.closure.RoadClosureExpiryService;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class RoadClosureIntegrationTest extends IntegrationTestBase {

    /** A quiet corner of the coverage area, apart from the other route/closure tests. */
    private static final Location ORIGIN = new Location(14.66, 121.07);

    @LocalServerPort
    int port;

    @Autowired
    RoadClosureExpiryService expiryService;

    @Test
    void moderatorBlocksARoadAndEveryoneSeesItUntilItIsLifted() throws Exception {
        TestUser mod = registerModerator();
        TestUser alice = registerUser();
        Location a = ORIGIN;
        Location b = ORIGIN.offsetMeters(0, 300);

        JsonNode created = create(mod, "Pasong Tamo repair", a, b, null, 201);
        String id = created.get("id").asText();
        assertThat(created.get("status").asText()).isEqualTo("ACTIVE");
        assertThat(created.get("coordinates")).hasSize(2);
        assertThat(created.get("coordinates").get(0).get(0).asDouble()).isEqualTo(a.lat());

        // Visible to a normal user in the viewport and in the active list.
        JsonNode inBox = json(mvc.perform(get("/api/closures/in-bbox").with(bearer(alice))
                .param("minLat", String.valueOf(a.lat() - 0.01)).param("minLon", String.valueOf(a.lon() - 0.01))
                .param("maxLat", String.valueOf(a.lat() + 0.01)).param("maxLon", String.valueOf(a.lon() + 0.01))).andReturn(), 200);
        assertThat(inBox.findValuesAsText("id")).contains(id);
        assertThat(json(mvc.perform(get("/api/closures/active").with(bearer(alice))).andReturn(), 200)
                .findValuesAsText("id")).contains(id);

        // Route assessment reports it for a route crossing it, but not for a route far away.
        JsonNode crossing = alongRoute(alice, a.offsetMeters(-100, 150), a.offsetMeters(100, 150));
        assertThat(crossing.get("closures").findValuesAsText("id")).contains(id);
        JsonNode far = alongRoute(alice, a.offsetMeters(2000, 0), a.offsetMeters(2000, 300));
        assertThat(far.get("closures").findValuesAsText("id")).doesNotContain(id);

        // Only staff lift; once lifted it disappears from routing.
        expectStatus(mvc.perform(delete("/api/closures/" + id).with(bearer(alice))).andReturn(), 403);
        JsonNode lifted = json(mvc.perform(delete("/api/closures/" + id).param("reason", "Works finished").with(bearer(mod))).andReturn(), 200);
        assertThat(lifted.get("status").asText()).isEqualTo("LIFTED");
        assertThat(alongRoute(alice, a.offsetMeters(-100, 150), a.offsetMeters(100, 150))
                .get("closures").findValuesAsText("id")).doesNotContain(id);
        expectStatus(mvc.perform(delete("/api/closures/" + id).with(bearer(mod))).andReturn(), 409);
    }

    @Test
    void onlyStaffCanBlockARoadAndTheShapeIsValidated() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        Location a = ORIGIN.offsetMeters(500, 0);

        create(alice, "Nope", a, a.offsetMeters(0, 100), null, 403);
        // A single point, a mis-click-sized line, a past end time and a point outside the pilot area.
        postRaw(mod, Map.of("name", "x", "reason", "y", "category", "OTHER",
                "coordinates", List.of(new double[]{a.lat(), a.lon()})), 400);
        create(mod, "Tiny", a, a.offsetMeters(0, 1), null, 400);
        create(mod, "Past", a, a.offsetMeters(0, 100), Instant.now().minusSeconds(60), 400);
        JsonNode outside = create(mod, "Elsewhere", new Location(10.0, 121.0), new Location(10.0, 121.001), null, 422);
        assertThat(outside.get("error").asText()).isEqualTo("OUTSIDE_COVERAGE_AREA");
    }

    @Test
    void aClosurePastItsEndTimeExpiresAndStopsBlocking() throws Exception {
        TestUser mod = registerModerator();
        TestUser alice = registerUser();
        Location a = ORIGIN.offsetMeters(1000, 0);
        JsonNode created = create(mod, "Short event", a, a.offsetMeters(0, 200), Instant.now().plusSeconds(3600), 201);
        String id = created.get("id").asText();
        assertThat(created.get("endsAt").asText()).isNotBlank();

        jdbc.update("UPDATE road_closures SET ends_at = now() - interval '1 minute' WHERE id = ?::uuid", id);
        expiryService.expireEndedClosures();

        assertThat(jdbc.queryForObject("SELECT status FROM road_closures WHERE id = ?::uuid", String.class, id)).isEqualTo("EXPIRED");
        assertThat(json(mvc.perform(get("/api/closures/active").with(bearer(alice))).andReturn(), 200)
                .findValuesAsText("id")).doesNotContain(id);
    }

    @Test
    void nearbyCommutersAndTheStaffMapGetClosureFramesLiveAndDistantOnesDoNot() throws Exception {
        TestUser mod = registerModerator();
        TestUser commuter = registerUser();
        TestUser farAway = registerUser();
        Location a = ORIGIN.offsetMeters(-1500, 0);

        Client near = connect(commuter);
        near.send(Map.of("type", "subscribe", "lat", a.lat(), "lon", a.lon()));
        Client far = connect(farAway);
        far.send(Map.of("type", "subscribe", "lat", a.offsetMeters(20_000, 0).lat(), "lon", a.lon()));
        Client portal = connect(mod);
        portal.send(Map.of("type", "watch", "bbox", List.of(a.lat() - 0.02, a.lon() - 0.02, a.lat() + 0.02, a.lon() + 0.02)));
        Thread.sleep(300);

        String id = create(mod, "Live closure", a, a.offsetMeters(0, 250), null, 201).get("id").asText();
        JsonNode frame = near.await(f -> "closure_changed".equals(f.get("type").asText()) && id.equals(f.get("closureId").asText()));
        assertThat(frame.get("change").asText()).isEqualTo("CREATED");
        assertThat(frame.get("status").asText()).isEqualTo("ACTIVE");
        assertThat(frame.get("coordinates")).hasSize(2);
        portal.await(f -> "closure_changed".equals(f.get("type").asText()) && id.equals(f.get("closureId").asText()));

        expectStatus(mvc.perform(delete("/api/closures/" + id).with(bearer(mod))).andReturn(), 200);
        JsonNode lifted = near.await(f -> "closure_changed".equals(f.get("type").asText())
                && "LIFTED".equals(f.get("change").asText()));
        assertThat(lifted.get("status").asText()).isEqualTo("LIFTED");

        assertThat(far.frames.poll(2, TimeUnit.SECONDS)).isNull();
        near.session.close();
        far.session.close();
        portal.session.close();
    }

    // ------------------------------------------------------------------ helpers

    private JsonNode create(TestUser who, String name, Location from, Location to, Instant endsAt, int expectedStatus) throws Exception {
        Map<String, Object> body = new HashMap<>(Map.of("name", name, "reason", "Road works", "category", "CONSTRUCTION",
                "coordinates", List.of(new double[]{from.lat(), from.lon()}, new double[]{to.lat(), to.lon()})));
        if (endsAt != null) body.put("endsAt", endsAt.toString());
        return postRaw(who, body, expectedStatus);
    }

    private JsonNode postRaw(TestUser who, Map<String, Object> body, int expectedStatus) throws Exception {
        return json(mvc.perform(post("/api/closures").with(bearer(who)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(body))).andReturn(), expectedStatus);
    }

    private JsonNode alongRoute(TestUser who, Location from, Location to) throws Exception {
        return json(mvc.perform(post("/api/hazards/along-route").with(bearer(who)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("routes", List.of(List.of(
                        new double[]{from.lat(), from.lon()}, new double[]{to.lat(), to.lon()})))))).andReturn(), 200);
    }

    private Client connect(TestUser user) throws Exception {
        var headers = new WebSocketHttpHeaders();
        headers.add("Authorization", "Bearer " + user.token());
        Client client = new Client();
        client.session = new StandardWebSocketClient()
                .execute(client, headers, URI.create("ws://localhost:" + port + "/ws/notifications")).get(5, TimeUnit.SECONDS);
        return client;
    }

    private class Client extends TextWebSocketHandler {
        final BlockingQueue<JsonNode> frames = new LinkedBlockingQueue<>();
        WebSocketSession session;

        @Override
        protected void handleTextMessage(@NonNull WebSocketSession session, @NonNull TextMessage message) throws Exception {
            frames.add(objectMapper.readTree(message.getPayload()));
        }

        void send(Object frame) throws Exception {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(frame)));
        }

        JsonNode await(Predicate<JsonNode> match) throws InterruptedException {
            long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
            while (System.nanoTime() < deadline) {
                JsonNode frame = frames.poll(500, TimeUnit.MILLISECONDS);
                if (frame != null && match.test(frame)) return frame;
            }
            throw new AssertionError("No matching WebSocket frame within 30s");
        }
    }
}
