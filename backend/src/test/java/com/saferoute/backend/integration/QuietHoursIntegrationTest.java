package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.push.PushMessage;
import com.saferoute.backend.support.IntegrationTestBase;
import com.saferoute.backend.support.RecordingPushSender;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.time.Duration;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Quiet hours hold push alerts back and round-trip through the preferences API. */
class QuietHoursIntegrationTest extends IntegrationTestBase {

    @Autowired
    RecordingPushSender pushSender;

    @Test
    void quietHoursRoundTripAndAreKeptWhenAnOlderAppOmitsThem() throws Exception {
        TestUser user = registerUser();
        JsonNode initial = json(mvc.perform(get("/api/me/notification-preferences").with(bearer(user))).andReturn(), 200);
        assertThat(initial.get("quietHours").get("enabled").asBoolean()).isFalse();

        putPreferences(user, Map.of("radiusMeters", 400, "enabledTypes", List.of("FLOODING"),
                "quietHours", Map.of("enabled", true, "startMinute", 1320, "endMinute", 420, "zone", "Asia/Manila")), 200);
        JsonNode saved = json(mvc.perform(get("/api/me/notification-preferences").with(bearer(user))).andReturn(), 200).get("quietHours");
        assertThat(saved.get("enabled").asBoolean()).isTrue();
        assertThat(saved.get("startMinute").asInt()).isEqualTo(1320);
        assertThat(saved.get("endMinute").asInt()).isEqualTo(420);

        // An older app that doesn't know about quiet hours must not switch them off.
        putPreferences(user, Map.of("radiusMeters", 500, "enabledTypes", List.of("FLOODING")), 200);
        JsonNode kept = json(mvc.perform(get("/api/me/notification-preferences").with(bearer(user))).andReturn(), 200);
        assertThat(kept.get("radiusMeters").asInt()).isEqualTo(500);
        assertThat(kept.get("quietHours").get("enabled").asBoolean()).isTrue();
    }

    @Test
    void invalidQuietHoursAreRejected() throws Exception {
        TestUser user = registerUser();
        putPreferences(user, Map.of("radiusMeters", 400, "enabledTypes", List.of("FLOODING"),
                "quietHours", Map.of("enabled", true, "startMinute", 1440, "endMinute", 0, "zone", "Asia/Manila")), 400);
        putPreferences(user, Map.of("radiusMeters", 400, "enabledTypes", List.of("FLOODING"),
                "quietHours", Map.of("enabled", true, "startMinute", 0, "endMinute", 60, "zone", "Mars/Olympus")), 400);
    }

    @Test
    void reportUpdatePushIsHeldDuringQuietHours() throws Exception {
        TestUser sleeper = registerUser();
        TestUser listener = registerUser();
        TestUser mod = registerModerator();
        String sleeperDevice = device(sleeper);
        String listenerDevice = device(listener);

        // A window that contains "now" in Manila time, whatever time the test runs.
        int now = minuteOfDayInManila();
        putPreferences(sleeper, Map.of("radiusMeters", 400, "enabledTypes", List.of("FLOODING"),
                "quietHours", Map.of("enabled", true, "startMinute", Math.floorMod(now - 120, 1440),
                        "endMinute", Math.floorMod(now + 120, 1440), "zone", "Asia/Manila")), 200);

        UUID held = reportAndAwaitHazard(sleeper, "FLOODING", freshLocation());
        expectStatus(mvc.perform(delete("/api/hazards/" + held).param("reason", "Spam").with(bearer(mod))).andReturn(), 200);

        // The second reporter, with no quiet hours, proves the removal was handled before we check the first.
        UUID heard = reportAndAwaitHazard(listener, "FLOODING", freshLocation());
        expectStatus(mvc.perform(delete("/api/hazards/" + heard).param("reason", "Spam").with(bearer(mod))).andReturn(), 200);
        await().atMost(Duration.ofSeconds(20)).until(() -> !reportUpdates(listenerDevice, heard).isEmpty());
        assertThat(reportUpdates(sleeperDevice, held)).isEmpty();
    }

    private static int minuteOfDayInManila() {
        ZonedDateTime now = ZonedDateTime.now(ZoneId.of("Asia/Manila"));
        return now.getHour() * 60 + now.getMinute();
    }

    private void putPreferences(TestUser user, Map<String, Object> body, int expected) throws Exception {
        expectStatus(mvc.perform(put("/api/me/notification-preferences").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(body))).andReturn(), expected);
    }

    private String device(TestUser user) throws Exception {
        StringBuilder token = new StringBuilder(64);
        for (int i = 0; i < 64; i++) token.append(Character.forDigit(ThreadLocalRandom.current().nextInt(16), 16));
        expectStatus(mvc.perform(put("/api/me/push-device").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("deviceToken", token.toString())))).andReturn(), 204);
        return token.toString();
    }

    private List<PushMessage> reportUpdates(String token, UUID hazard) {
        return pushSender.sentTo(token, hazard).stream().filter(m -> "report_update".equals(m.kind())).toList();
    }
}
