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

/** Reporters hear what happened to their reports: assigned, resolved, removed. */
class ReportFollowUpIntegrationTest extends IntegrationTestBase {

    @Autowired
    RecordingPushSender pushSender;

    @Test
    void everyReporterHearsWhenTheCityAssignsAndResolves() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        TestUser mod = registerModerator();
        String aliceDevice = device(alice);
        String bobDevice = device(bob);
        String modDevice = device(mod);
        Location at = freshLocation();
        UUID hazard = reportAndAwaitHazard(alice, "OPEN_MANHOLE", at);
        // Bob's report of the same manhole is merged into Alice's; he's a reporter too.
        awaitSubmission(bob, submit(bob, "OPEN_MANHOLE", at.offsetMeters(5, 0)));

        expectStatus(mvc.perform(put("/api/moderation/hazards/" + hazard + "/response").with(bearer(mod))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("department", "ENGINEERING")))).andReturn(), 200);
        PushMessage assigned = awaitReportUpdate(aliceDevice, hazard, 1);
        assertThat(assigned.title()).isEqualTo("The city is on it");
        assertThat(assigned.body()).isEqualTo("Makati City assigned your open manhole report to Engineering.");
        awaitReportUpdate(bobDevice, hazard, 1);

        expectStatus(mvc.perform(post("/api/hazards/" + hazard + "/resolve").with(bearer(mod))).andReturn(), 202);
        PushMessage resolved = awaitReportUpdate(aliceDevice, hazard, 2);
        assertThat(resolved.title()).isEqualTo("Your report was resolved");

        // The official who made the changes isn't notified about them.
        assertThat(reportUpdates(modDevice, hazard)).isEmpty();
    }

    @Test
    void reportersCanTurnUpdatesOff() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        String aliceDevice = device(alice);
        expectStatus(mvc.perform(put("/api/me/notification-preferences").with(bearer(alice))
                .contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("radiusMeters", 400, "enabledTypes", List.of("FLOODING"), "reportUpdates", false)))).andReturn(), 200);
        assertThat(json(mvc.perform(get("/api/me/notification-preferences").with(bearer(alice))).andReturn(), 200)
                .get("reportUpdates").asBoolean()).isFalse();

        UUID quiet = reportAndAwaitHazard(alice, "FLOODING", freshLocation());
        expectStatus(mvc.perform(delete("/api/hazards/" + quiet).param("reason", "Spam").with(bearer(mod))).andReturn(), 200);

        // A second, opted-in reporter proves the removal event was handled before we check Alice.
        TestUser carol = registerUser();
        String carolDevice = device(carol);
        UUID loud = reportAndAwaitHazard(carol, "FLOODING", freshLocation());
        expectStatus(mvc.perform(delete("/api/hazards/" + loud).param("reason", "Spam").with(bearer(mod))).andReturn(), 200);
        assertThat(awaitReportUpdate(carolDevice, loud, 1).title()).isEqualTo("Your report was removed");
        assertThat(reportUpdates(aliceDevice, quiet)).isEmpty();
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

    private PushMessage awaitReportUpdate(String token, UUID hazard, int count) {
        await().atMost(Duration.ofSeconds(20)).until(() -> reportUpdates(token, hazard).size() >= count);
        List<PushMessage> updates = reportUpdates(token, hazard);
        assertThat(updates).hasSize(count);
        return updates.get(count - 1);
    }
}
