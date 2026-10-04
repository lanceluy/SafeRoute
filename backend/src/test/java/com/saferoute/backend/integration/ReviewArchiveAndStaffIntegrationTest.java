package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.hazard.HazardArchiveService;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Task 2 revisions: the one-week archive, collated duplicates and staff-created official accounts. */
class ReviewArchiveAndStaffIntegrationTest extends IntegrationTestBase {

    @Autowired HazardArchiveService archiveService;

    @Test
    void unreviewedReportsAreArchivedAfterAWeekButStayOnTheMap() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        Location at = freshLocation();
        UUID stale = reportAndAwaitHazard(alice, "BROKEN_SIDEWALK", at);
        UUID reviewed = reportAndAwaitHazard(alice, "POOR_LIGHTING", at.offsetMeters(0, 60));
        UUID fresh = reportAndAwaitHazard(alice, "ACCESSIBILITY_BARRIER", at.offsetMeters(0, 120));
        backdate(stale, 8);
        backdate(reviewed, 8);
        backdate(fresh, 6);
        json(mvc.perform(post("/api/moderation/hazards/" + reviewed + "/review").with(bearer(mod))).andReturn(), 200);

        archiveService.archiveUnreviewed();

        String box = bbox(at);
        assertThat(queue(mod, "bbox", box, "view", "archived")).containsExactly(stale);
        assertThat(queue(mod, "bbox", box, "view", "unconfirmed")).containsExactlyInAnyOrder(reviewed, fresh);
        assertThat(queue(mod, "bbox", box, "view", "active")).containsExactlyInAnyOrder(stale, reviewed, fresh);
        // Commuters still see it: archiving is a portal-queue matter only.
        JsonNode seen = hazardDetail(alice, stale).get("hazard");
        assertThat(seen.get("status").asText()).isEqualTo("REPORTED");
        assertThat(seen.get("archivedAt").isNull()).isFalse();

        // Mark reviewed brings it back and stops the clock for good.
        JsonNode back = json(mvc.perform(post("/api/moderation/hazards/" + stale + "/review").with(bearer(mod))).andReturn(), 200);
        assertThat(back.get("archivedAt").isNull()).isTrue();
        assertThat(back.get("reviewedAt").isNull()).isFalse();
        archiveService.archiveUnreviewed();
        assertThat(queue(mod, "bbox", box, "view", "archived")).isEmpty();

        JsonNode timeline = json(mvc.perform(get("/api/hazards/" + stale + "/history").with(bearer(alice))).andReturn(), 200);
        assertThat(timeline.findValuesAsText("action")).contains("ARCHIVED", "STAFF_REVIEWED");
        expectStatus(mvc.perform(post("/api/moderation/hazards/" + fresh + "/review").with(bearer(alice))).andReturn(), 403);
    }

    @Test
    void aCityResponseCountsAsReview() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        UUID hazard = reportAndAwaitHazard(alice, "OPEN_MANHOLE", freshLocation());
        backdate(hazard, 8);
        json(mvc.perform(put("/api/moderation/hazards/" + hazard + "/response").with(bearer(mod))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("department", "ENGINEERING")))).andReturn(), 200);
        archiveService.archiveUnreviewed();
        assertThat(hazardDetail(alice, hazard).get("hazard").get("archivedAt").isNull()).isTrue();
    }

    @Test
    void matchingReportsAreCollatedIntoTheDuplicatesTab() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        TestUser mod = registerModerator();
        Location at = freshLocation();
        UUID hazard = reportAndAwaitHazard(alice, "OPEN_MANHOLE", at);
        UUID single = reportAndAwaitHazard(alice, "FLOODING", at.offsetMeters(0, 80));
        awaitSubmission(bob, submit(bob, "OPEN_MANHOLE", at.offsetMeters(10, 5)));

        assertThat(queue(mod, "bbox", bbox(at), "view", "duplicates")).containsExactly(hazard);
        assertThat(hazardDetail(alice, hazard).get("hazard").get("mergedReportCount").asInt()).isEqualTo(1);
        assertThat(hazardDetail(alice, single).get("hazard").get("mergedReportCount").asInt()).isZero();
    }

    @Test
    void officialsCreateStaffAccountsThatCanModerate() throws Exception {
        TestUser official = registerOfficial();
        TestUser mod = registerModerator();
        TestUser alice = registerUser();
        String email = "agent-" + UUID.randomUUID() + "@makati.test";
        Map<String, Object> body = Map.of("email", email, "password", "temporary123", "displayName", "Makati Agent");

        expectStatus(mvc.perform(post("/api/moderation/staff").with(bearer(alice))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(body))).andReturn(), 403);
        expectStatus(mvc.perform(post("/api/moderation/staff").with(bearer(mod))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(body))).andReturn(), 403);
        JsonNode created = json(mvc.perform(post("/api/moderation/staff").with(bearer(official))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(body))).andReturn(), 201);
        assertThat(created.get("role").asText()).isEqualTo("MUNICIPAL_OFFICIAL");
        expectStatus(mvc.perform(post("/api/moderation/staff").with(bearer(official))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(body))).andReturn(), 409);

        // The new agent signs in and can work the queue.
        JsonNode login = json(mvc.perform(post("/api/auth/login").with(uniqueIp()).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("email", email, "password", "temporary123")))).andReturn(), 200);
        String agentToken = login.get("token").asText();
        json(mvc.perform(get("/api/moderation/hazards").with(bearer(agentToken))).andReturn(), 200);

        JsonNode staff = json(mvc.perform(get("/api/moderation/staff").with(bearer(official))).andReturn(), 200);
        assertThat(staff.findValuesAsText("email")).contains(email);
        assertThat(jdbc.queryForObject("SELECT granted_by FROM role_grants WHERE user_id = ?", UUID.class,
                UUID.fromString(created.get("id").asText()))).isEqualTo(official.id());

        expectStatus(mvc.perform(delete("/api/moderation/staff/" + official.id()).with(bearer(official))).andReturn(), 409);
        expectStatus(mvc.perform(delete("/api/moderation/staff/" + created.get("id").asText()).with(bearer(official))).andReturn(), 204);
        assertThat(jdbc.queryForObject("SELECT role FROM users WHERE email = ?", String.class, email)).isEqualTo("USER");
    }

    private void backdate(UUID hazard, int days) {
        jdbc.update("UPDATE hazards SET created_at = now() - make_interval(days => ?) WHERE id = ?", days, hazard);
    }

    private List<UUID> queue(TestUser mod, String... params) throws Exception {
        var request = get("/api/moderation/hazards").with(bearer(mod));
        for (int i = 0; i < params.length; i += 2) request = request.param(params[i], params[i + 1]);
        return json(mvc.perform(request).andReturn(), 200).get("items").findValuesAsText("id").stream().map(UUID::fromString).toList();
    }

    private static String bbox(Location at) {
        Location sw = at.offsetMeters(-150, -150);
        Location ne = at.offsetMeters(150, 150);
        return sw.lat() + "," + sw.lon() + "," + ne.lat() + "," + ne.lon();
    }
}
