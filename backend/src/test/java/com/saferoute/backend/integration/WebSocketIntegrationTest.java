package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.lang.NonNull;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WebSocketIntegrationTest extends IntegrationTestBase {

    @LocalServerPort
    int port;

    @Test
    void handshakeWithoutValidTokenIsRejected() {
        var client = new StandardWebSocketClient();
        assertThatThrownBy(() -> client.execute(new TextWebSocketHandler(), new WebSocketHttpHeaders(), uri()).get(5, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class);
        var badHeaders = new WebSocketHttpHeaders();
        badHeaders.add("Authorization", "Bearer garbage");
        assertThatThrownBy(() -> client.execute(new TextWebSocketHandler(), badHeaders, uri()).get(5, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class);
        // Query-string tokens are disabled by default (they leak into access logs).
        assertThatThrownBy(() -> client.execute(new TextWebSocketHandler(), new WebSocketHttpHeaders(),
                URI.create(uri() + "?token=whatever")).get(5, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class);
    }

    @Test
    void nearbyCommuterGetsAlertAndStatusUpdatesWhileDistantOneDoesNot() throws Exception {
        TestUser watcher = registerUser();
        TestUser farAway = registerUser();
        TestUser reporter = registerUser();
        TestUser v1 = registerUser();
        TestUser v2 = registerUser();
        Location at = freshLocation();

        Client near = connect(watcher);
        near.subscribe(at.offsetMeters(100, 0));
        Client far = connect(farAway);
        far.subscribe(at.offsetMeters(20_000, 0)); // 20 km north: beyond the 5 km map-update radius

        submit(reporter, "OPEN_MANHOLE", at);
        JsonNode created = near.await(f -> "hazard_created".equals(f.get("type").asText())
                && "OPEN_MANHOLE".equals(f.get("hazardType").asText()) && f.get("distanceMeters").asDouble() < 150);
        UUID hazardId = UUID.fromString(created.get("hazardId").asText());
        assertThat(created.get("alert").asBoolean()).isTrue();
        assertThat(created.get("distanceMeters").asDouble()).isBetween(90.0, 110.0);

        confirm(v1, hazardId, "VERIFY");
        confirm(v2, hazardId, "VERIFY");
        JsonNode verified = near.await(f -> "hazard_verified".equals(f.get("type").asText())
                && hazardId.toString().equals(f.get("hazardId").asText()));
        assertThat(verified.get("status").asText()).isEqualTo("VERIFIED");
        assertThat(verified.get("confirmationCount").asInt()).isEqualTo(2);

        assertThat(far.frames.poll(2, TimeUnit.SECONDS)).isNull();
        near.close();
        far.close();
    }

    @Test
    void submitterReceivesSubmissionProcessedFrame() throws Exception {
        TestUser reporter = registerUser();
        Client client = connect(reporter);
        client.subscribe(freshLocation());
        UUID submissionId = submit(reporter, "FLOODING", freshLocation());
        JsonNode frame = client.await(f -> "submission_processed".equals(f.get("type").asText()));
        assertThat(frame.get("submissionId").asText()).isEqualTo(submissionId.toString());
        assertThat(frame.get("status").asText()).isEqualTo("CREATED");
        assertThat(frame.get("hazardId").asText()).isNotBlank();
        client.close();
    }

    @Test
    void activeRouteRestrictsAlertsToHazardsAheadOnTheRoute() throws Exception {
        TestUser walker = registerUser();
        TestUser reporter = registerUser();
        Location start = freshLocation();
        Location end = start.offsetMeters(1000, 0);

        Client client = connect(walker);
        client.subscribe(start);
        client.send(Map.of("type", "route", "route", List.of(
                new double[]{start.lat(), start.lon()}, new double[]{end.lat(), end.lon()})));
        Thread.sleep(300);

        // 150 m off to the side: nearby (inside default 400 m radius) but not on the route.
        submit(reporter, "BROKEN_SIDEWALK", start.offsetMeters(200, 150));
        JsonNode offRoute = client.await(f -> "hazard_created".equals(f.get("type").asText())
                && "BROKEN_SIDEWALK".equals(f.get("hazardType").asText()));
        assertThat(offRoute.get("onRoute").asBoolean()).isFalse();
        assertThat(offRoute.get("alert").asBoolean()).isFalse();

        // On the route, 600 m ahead: beyond the 400 m radius, but relevant.
        submit(reporter, "FLOODING", start.offsetMeters(600, 5));
        JsonNode ahead = client.await(f -> "hazard_created".equals(f.get("type").asText())
                && "FLOODING".equals(f.get("hazardType").asText()) && f.get("onRoute").asBoolean());
        assertThat(ahead.get("alert").asBoolean()).isTrue();
        assertThat(ahead.get("distanceAheadMeters").asDouble()).isBetween(580.0, 620.0);
        client.close();
    }

    private URI uri() {
        return URI.create("ws://localhost:" + port + "/ws/notifications");
    }

    private Client connect(TestUser user) throws Exception {
        var headers = new WebSocketHttpHeaders();
        headers.add("Authorization", "Bearer " + user.token());
        Client client = new Client();
        client.session = new StandardWebSocketClient().execute(client, headers, uri()).get(5, TimeUnit.SECONDS);
        return client;
    }

    private class Client extends TextWebSocketHandler {
        final BlockingQueue<JsonNode> frames = new LinkedBlockingQueue<>();
        WebSocketSession session;

        @Override
        protected void handleTextMessage(@NonNull WebSocketSession session, @NonNull TextMessage message) throws Exception {
            frames.add(objectMapper.readTree(message.getPayload()));
        }

        void subscribe(Location at) throws Exception {
            send(Map.of("type", "subscribe", "lat", at.lat(), "lon", at.lon()));
            Thread.sleep(200); // let the server register the location before events flow
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

        void close() throws Exception {
            session.close();
        }
    }
}
