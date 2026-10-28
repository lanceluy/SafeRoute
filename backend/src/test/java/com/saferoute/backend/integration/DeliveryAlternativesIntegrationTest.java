package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** The comparison channels: conditional GET (ETag), long polling and Server-Sent Events. */
class DeliveryAlternativesIntegrationTest extends IntegrationTestBase {

    /** A quiet corner, apart from the other tests' locations. */
    private static final Location ORIGIN = new Location(14.70, 121.10);

    @LocalServerPort
    int port;

    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void unchangedAreaGets304AndAChangeBreaksTheEtag() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = ORIGIN;

        var first = mvc.perform(get("/api/hazards/nearby").with(bearer(alice))
                .param("lat", String.valueOf(at.lat())).param("lon", String.valueOf(at.lon()))).andReturn().getResponse();
        assertThat(first.getStatus()).isEqualTo(200);
        String etag = first.getHeader("ETag");
        assertThat(etag).isNotBlank();

        var unchanged = mvc.perform(get("/api/hazards/nearby").with(bearer(alice))
                .header("If-None-Match", etag)
                .param("lat", String.valueOf(at.lat())).param("lon", String.valueOf(at.lon()))).andReturn().getResponse();
        assertThat(unchanged.getStatus()).isEqualTo(304);
        assertThat(unchanged.getContentAsString()).isEmpty();
        assertThat(unchanged.getHeader("ETag")).isEqualTo(etag);

        awaitSubmission(bob, submit(bob, "FLOODING", at));
        var changed = mvc.perform(get("/api/hazards/nearby").with(bearer(alice))
                .header("If-None-Match", etag)
                .param("lat", String.valueOf(at.lat())).param("lon", String.valueOf(at.lon()))).andReturn().getResponse();
        assertThat(changed.getStatus()).isEqualTo(200);
        assertThat(changed.getHeader("ETag")).isNotEqualTo(etag);
    }

    @Test
    void longPollIsReleasedByANewHazardAndReplaysWhatItMissed() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = ORIGIN.offsetMeters(600, 0);

        JsonNode init = getJson(alice, "/api/hazards/poll?lat=" + at.lat() + "&lon=" + at.lon() + "&radiusMeters=300");
        String cursor = init.get("cursor").asText();
        assertThat(init.get("changes")).isEmpty();

        // The poll is held open until the hazard arrives, well inside the 25 s hold.
        CompletableFuture<JsonNode> held = CompletableFuture.supplyAsync(() -> {
            try {
                return getJson(alice, "/api/hazards/poll?lat=" + at.lat() + "&lon=" + at.lon() + "&radiusMeters=300&since=" + cursor);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        Thread.sleep(300);
        assertThat(held).isNotDone();
        UUIDHolder hazard = new UUIDHolder(awaitSubmission(bob, submit(bob, "OPEN_MANHOLE", at)).get("hazardId").asText());

        JsonNode released = held.get(20, TimeUnit.SECONDS);
        assertThat(released.get("resync").asBoolean()).isFalse();
        assertThat(released.get("changes").findValuesAsText("hazardId")).contains(hazard.id());

        // A poll that starts after the change still sees it from the replay buffer.
        JsonNode replay = getJson(alice, "/api/hazards/poll?lat=" + at.lat() + "&lon=" + at.lon() + "&radiusMeters=300&since=" + cursor);
        assertThat(replay.get("changes").findValuesAsText("hazardId")).contains(hazard.id());

        // A cursor from another instance asks the client to resync.
        JsonNode foreign = getJson(alice, "/api/hazards/poll?lat=" + at.lat() + "&lon=" + at.lon() + "&radiusMeters=300&since=deadbeef:1");
        assertThat(foreign.get("resync").asBoolean()).isTrue();
    }

    @Test
    void sseStreamsNearbyChangesAndSkipsFarOnes() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = ORIGIN.offsetMeters(1200, 0);
        Location far = at.offsetMeters(9000, 0);

        List<String> lines = new CopyOnWriteArrayList<>();
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/hazards/stream?lat="
                        + at.lat() + "&lon=" + at.lon() + "&radiusMeters=2000"))
                .header("Authorization", "Bearer " + alice.token()).header("Accept", "text/event-stream").build();
        CompletableFuture<HttpResponse<Void>> stream = http.sendAsync(request,
                HttpResponse.BodyHandlers.fromLineSubscriber(new java.util.concurrent.Flow.Subscriber<String>() {
                    @Override public void onSubscribe(java.util.concurrent.Flow.Subscription s) { s.request(Long.MAX_VALUE); }
                    @Override public void onNext(String item) { lines.add(item); }
                    @Override public void onError(Throwable t) { }
                    @Override public void onComplete() { }
                }));
        awaitLine(lines, l -> l.contains("connected"));

        awaitSubmission(bob, submit(bob, "FLOODING", far));
        String nearId = awaitSubmission(bob, submit(bob, "POOR_LIGHTING", at)).get("hazardId").asText();

        awaitLine(lines, l -> l.startsWith("data:") && l.contains(nearId));
        assertThat(lines).anyMatch(l -> l.startsWith("event:hazard_created") || l.startsWith("event: hazard_created"));
        assertThat(lines).noneMatch(l -> l.contains(String.valueOf(far.lat()).substring(0, 7)) && l.startsWith("data:") && l.contains("\"latitude\":" + far.lat()));
        stream.cancel(true);
    }

    private record UUIDHolder(String id) {
    }

    private JsonNode getJson(TestUser user, String path) throws Exception {
        HttpResponse<String> res = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Authorization", "Bearer " + user.token()).timeout(Duration.ofSeconds(40)).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(res.statusCode()).as(path).isEqualTo(200);
        return objectMapper.readTree(res.body());
    }

    private static void awaitLine(List<String> lines, java.util.function.Predicate<String> match) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 20_000;
        while (System.currentTimeMillis() < deadline) {
            if (lines.stream().anyMatch(match)) return;
            Thread.sleep(50);
        }
        throw new AssertionError("Timed out waiting for SSE line; saw " + lines);
    }
}
