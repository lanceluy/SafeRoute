package com.saferoute.backend.integration;

import com.saferoute.backend.push.PushMessage;
import com.saferoute.backend.support.IntegrationTestBase;
import com.saferoute.backend.support.RecordingPushSender;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Background (APNs) alerts: device registration, relevance filtering and invalid-token cleanup. */
class PushNotificationIntegrationTest extends IntegrationTestBase {

    @Autowired
    RecordingPushSender pushSender;

    @Test
    void nearbyAlertIsPushedWithReadableText() throws Exception {
        Location at = freshLocation();
        String token = deviceNear(registerUser(), at.offsetMeters(120, 0));

        UUID hazardId = reportAndAwaitHazard(registerUser(), "OPEN_MANHOLE", at);

        PushMessage message = awaitPush(token, hazardId);
        assertThat(message.title()).isEqualTo("Hazard near you: Open manhole");
        assertThat(message.body()).startsWith("About 120 m from where you last were.");
    }

    @Test
    void irrelevantDevicesAreNotPushed() throws Exception {
        Location at = freshLocation();
        String control = deviceNear(registerUser(), at.offsetMeters(50, 0));
        String tooFar = deviceNear(registerUser(), at.offsetMeters(1000, 0)); // default radius is 400 m

        TestUser floodOnly = registerUser();
        expectStatus(mvc.perform(put("/api/me/notification-preferences").with(bearer(floodOnly))
                .contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("radiusMeters", 400, "enabledTypes", List.of("FLOODING"))))).andReturn(), 200);
        String typeDisabled = deviceNear(floodOnly, at.offsetMeters(50, 0));

        TestUser stale = registerUser();
        String staleToken = deviceNear(stale, at.offsetMeters(50, 0));
        jdbc.update("UPDATE push_devices SET location_updated_at = now() - interval '3 hours' WHERE device_token = ?", staleToken);

        TestUser reporter = registerUser();
        String reporterToken = deviceNear(reporter, at);

        UUID hazardId = reportAndAwaitHazard(reporter, "BROKEN_SIDEWALK", at);

        awaitPush(control, hazardId);
        // The control's push proves the event was handled; give the rest of the loop time to finish.
        Thread.sleep(1000);
        for (String token : List.of(tooFar, typeDisabled, staleToken, reporterToken)) {
            assertThat(pushSender.sentTo(token, hazardId)).as("push to %s", token).isEmpty();
        }
    }

    @Test
    void tokensApnsRejectsAreForgotten() throws Exception {
        Location at = freshLocation();
        TestUser user = registerUser();
        String token = RecordingPushSender.INVALID_TOKEN_PREFIX + randomHex(60);
        register(user, token);
        setLocation(user, token, at.offsetMeters(30, 0), 204);

        UUID hazardId = reportAndAwaitHazard(registerUser(), "CONSTRUCTION", at);

        awaitPush(token, hazardId);
        await().atMost(Duration.ofSeconds(10)).until(() -> deviceCount(token) == 0);
    }

    @Test
    void devicesBelongToOneAccount() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        String token = randomHex(64);
        register(alice, token);
        setLocation(alice, token, freshLocation(), 204);

        // Someone else can neither move nor delete Alice's device.
        json(mvc.perform(put("/api/me/push-device/" + token + "/location").with(bearer(bob))
                .contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("latitude", BASE_LAT, "longitude", BASE_LON)))).andReturn(), 404);
        expectStatus(mvc.perform(delete("/api/me/push-device/" + token).with(bearer(bob))).andReturn(), 204);
        assertThat(deviceCount(token)).isEqualTo(1);

        // Logging in as Bob on the same phone moves the device to Bob and drops Alice's location.
        register(bob, token);
        assertThat(jdbc.queryForObject("SELECT user_id FROM push_devices WHERE device_token = ?", UUID.class, token))
                .isEqualTo(bob.id());
        assertThat(jdbc.queryForObject("SELECT latitude FROM push_devices WHERE device_token = ?", Double.class, token))
                .isNull();

        expectStatus(mvc.perform(delete("/api/me/push-device/" + token).with(bearer(bob))).andReturn(), 204);
        assertThat(deviceCount(token)).isZero();
    }

    @Test
    void malformedRequestsAreRejected() throws Exception {
        TestUser user = registerUser();
        json(mvc.perform(put("/api/me/push-device").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("deviceToken", "not-hex")))).andReturn(), 400);
        String token = randomHex(64);
        register(user, token);
        json(mvc.perform(put("/api/me/push-device/" + token + "/location").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("latitude", 91, "longitude", BASE_LON)))).andReturn(), 400);
        json(mvc.perform(put("/api/me/push-device").contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("deviceToken", token)))).andReturn(), 401);
    }

    private String deviceNear(TestUser user, Location location) throws Exception {
        String token = randomHex(64);
        register(user, token);
        setLocation(user, token, location, 204);
        return token;
    }

    private void register(TestUser user, String token) throws Exception {
        expectStatus(mvc.perform(put("/api/me/push-device").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("deviceToken", token)))).andReturn(), 204);
    }

    private void setLocation(TestUser user, String token, Location location, int expectedStatus) throws Exception {
        expectStatus(mvc.perform(put("/api/me/push-device/" + token + "/location").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("latitude", location.lat(), "longitude", location.lon())))).andReturn(), expectedStatus);
    }

    private PushMessage awaitPush(String token, UUID hazardId) {
        await().atMost(Duration.ofSeconds(20)).until(() -> !pushSender.sentTo(token, hazardId).isEmpty());
        List<PushMessage> messages = pushSender.sentTo(token, hazardId);
        assertThat(messages).hasSize(1);
        return messages.get(0);
    }

    private int deviceCount(String token) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM push_devices WHERE device_token = ?", Integer.class, token);
        return count == null ? 0 : count;
    }

    private static String randomHex(int length) {
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) sb.append(Character.forDigit(ThreadLocalRandom.current().nextInt(16), 16));
        return sb.toString();
    }
}
