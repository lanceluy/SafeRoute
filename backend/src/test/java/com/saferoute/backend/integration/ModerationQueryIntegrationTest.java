package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.hazard.HazardLifecycle;
import com.saferoute.backend.hazard.HazardStatus;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class ModerationQueryIntegrationTest extends IntegrationTestBase {

    @Test
    void commutersCannotReadStatsOrActivity() throws Exception {
        TestUser alice = registerUser();
        json(mvc.perform(get("/api/moderation/stats").with(bearer(alice))).andReturn(), 403);
        json(mvc.perform(get("/api/moderation/activity").with(bearer(alice))).andReturn(), 403);
    }

    @Test
    void queueFiltersAndSorts() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        Location at = freshLocation();
        UUID manhole = reportAndAwaitHazard(alice, "OPEN_MANHOLE", at);
        UUID flooding = reportAndAwaitHazard(alice, "FLOODING", at.offsetMeters(0, 60));
        UUID lighting = reportAndAwaitHazard(alice, "POOR_LIGHTING", at.offsetMeters(0, 120));
        jdbc.update("UPDATE hazards SET severity = 'HIGH', created_at = now() - interval '3 days' WHERE id = ?", manhole);
        jdbc.update("UPDATE hazards SET severity = 'LOW', dispute_count = 4, created_at = now() - interval '1 day' WHERE id = ?", flooding);
        jdbc.update("UPDATE hazards SET description = 'Streetlight out near the Ayala underpass' WHERE id = ?", lighting);
        String box = bbox(at, 150);

        assertThat(queue(mod, "bbox", box, "sort", "oldest")).containsExactly(manhole, flooding, lighting);
        assertThat(queue(mod, "bbox", box, "sort", "newest")).containsExactly(lighting, flooding, manhole);
        assertThat(queue(mod, "bbox", box, "sort", "severity").get(0)).isEqualTo(manhole);
        assertThat(queue(mod, "bbox", box, "sort", "disputed").get(0)).isEqualTo(flooding);
        jdbc.update("UPDATE hazards SET updated_at = now() + interval '1 minute' WHERE id = ?", manhole);
        assertThat(queue(mod, "bbox", box, "sort", "updated").get(0)).isEqualTo(manhole);
        assertThat(queue(mod, "bbox", box, "types", "OPEN_MANHOLE,FLOODING")).containsExactlyInAnyOrder(manhole, flooding);
        assertThat(queue(mod, "bbox", box, "severities", "HIGH")).containsExactly(manhole);
        assertThat(queue(mod, "bbox", box, "view", "high")).containsExactly(manhole);
        // Unverified high severity needs attention, as does anything nobody has weighed in on for a day.
        assertThat(queue(mod, "bbox", box, "view", "attention")).containsExactly(manhole);
        // New reports are listed from the moment they arrive, until they are a day old.
        assertThat(queue(mod, "bbox", box, "view", "recent")).containsExactly(lighting);
        assertThat(queue(mod, "bbox", box, "q", "ayala")).containsExactly(lighting);
        assertThat(queue(mod, "bbox", box, "q", "open manhole")).containsExactly(manhole);
        assertThat(queue(mod, "bbox", box, "from", Instant.now().minus(2, ChronoUnit.DAYS).toString()))
                .containsExactlyInAnyOrder(flooding, lighting);

        json(mvc.perform(get("/api/moderation/hazards").param("sort", "loudest").with(bearer(mod))).andReturn(), 400);
        json(mvc.perform(get("/api/moderation/hazards").param("bbox", "1,2,3").with(bearer(mod))).andReturn(), 400);
    }

    /** The SQL confidence filter must agree with {@link HazardLifecycle#confidence} for every combination. */
    @Test
    void confidenceFilterMatchesTheJavaRules() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        Location at = freshLocation();
        UUID hazard = reportAndAwaitHazard(alice, "CONSTRUCTION", at);
        String box = bbox(at, 50);
        for (HazardStatus status : List.of(HazardStatus.REPORTED, HazardStatus.VERIFIED, HazardStatus.DISPUTED)) {
            for (int verifies : new int[]{0, 1, 3, 4, 5, 8}) {
                for (int disputes : new int[]{0, 1, 2, 3}) {
                    jdbc.update("UPDATE hazards SET status = ?, confirmation_count = ?, dispute_count = ? WHERE id = ?",
                            status.name(), verifies, disputes, hazard);
                    String expected = Objects.requireNonNull(HazardLifecycle.confidence(status, verifies, disputes)).name();
                    assertThat(queue(mod, "bbox", box, "confidences", expected))
                            .as("%s with %d verifies, %d disputes", status, verifies, disputes)
                            .containsExactly(hazard);
                }
            }
        }
    }

    @Test
    void statsCountActiveHazardsAndResolutionTime() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        JsonNode before = stats(mod);
        Location at = freshLocation();
        UUID high = reportAndAwaitHazard(alice, "OPEN_MANHOLE", at);
        UUID fixed = reportAndAwaitHazard(alice, "BROKEN_SIDEWALK", at.offsetMeters(0, 80));
        jdbc.update("UPDATE hazards SET severity = 'HIGH' WHERE id = ?", high);
        resolve(mod, fixed);
        jdbc.update("UPDATE hazards SET created_at = resolved_at - interval '10 hours' WHERE id = ?", fixed);

        JsonNode after = stats(mod);
        assertThat(after.at("/totals/active").asLong()).isEqualTo(before.at("/totals/active").asLong() + 1);
        assertThat(after.at("/totals/highSeverity").asLong()).isEqualTo(before.at("/totals/highSeverity").asLong() + 1);
        assertThat(after.at("/totals/resolvedInRange").asLong()).isEqualTo(before.at("/totals/resolvedInRange").asLong() + 1);
        assertThat(after.at("/queueCounts/high").asLong()).isEqualTo(after.at("/totals/highSeverity").asLong());
        assertThat(after.get("activeByType").findValuesAsText("key")).hasSize(7);
        assertThat(after.get("daily")).hasSizeBetween(7, 8);
        JsonNode today = after.get("daily").get(after.get("daily").size() - 1);
        assertThat(today.get("resolved").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(after.at("/resolution/byType").findValuesAsText("type")).contains("BROKEN_SIDEWALK");

        json(mvc.perform(get("/api/moderation/stats").param("tz", "Mars/Olympus").with(bearer(mod))).andReturn(), 400);
    }

    @Test
    void statsBreakDownOutcomesVerificationReportTimesAndHotspots() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        TestUser carol = registerUser();
        TestUser mod = registerModerator();
        JsonNode before = stats(mod);
        Instant start = Instant.now().minusSeconds(1);
        // Three different types within 30 m along one axis: at least two share a hotspot cell.
        Location at = freshLocation();
        UUID manhole = reportAndAwaitHazard(alice, "OPEN_MANHOLE", at);
        UUID lighting = reportAndAwaitHazard(alice, "POOR_LIGHTING", at.offsetMeters(0, 15));
        reportAndAwaitHazard(alice, "CONSTRUCTION", at.offsetMeters(0, 30));
        confirm(bob, manhole, "VERIFY");
        confirm(carol, manhole, "VERIFY");
        awaitHazard(mod, manhole, h -> "VERIFIED".equals(h.get("status").asText()));
        resolve(mod, lighting);

        JsonNode after = stats(mod);
        assertThat(after.at("/outcomes/resolved").asLong()).isEqualTo(before.at("/outcomes/resolved").asLong() + 1);
        assertThat(after.at("/verification/verifiedCount").asLong()).isEqualTo(before.at("/verification/verifiedCount").asLong() + 1);
        assertThat(after.at("/verification/byType").findValuesAsText("type")).contains("OPEN_MANHOLE");
        assertThat(sumCounts(after.get("reportTimes"))).isEqualTo(sumCounts(before.get("reportTimes")) + 3);
        for (JsonNode day : after.get("daily")) {
            assertThat(day.get("reportedHigh").asLong() + day.get("reportedMedium").asLong() + day.get("reportedLow").asLong())
                    .isEqualTo(day.get("reported").asLong());
        }
        JsonNode today = after.get("daily").get(after.get("daily").size() - 1);
        assertThat(today.get("newReports").asLong()).isGreaterThanOrEqualTo(3);
        // Only the busiest places are listed, so look at this test's own reports alone.
        JsonNode mine = json(mvc.perform(get("/api/moderation/stats").param("from", start.toString()).with(bearer(mod))).andReturn(), 200);
        boolean hotspotHere = false;
        for (JsonNode h : mine.get("hotspots")) {
            if (Math.abs(h.get("latitude").asDouble() - at.lat()) < 0.002 && Math.abs(h.get("longitude").asDouble() - at.lon()) < 0.002
                    && h.get("count").asLong() >= 2) hotspotHere = true;
        }
        assertThat(hotspotHere).as("a hotspot at the three reports").isTrue();
    }

    private static long sumCounts(JsonNode cells) {
        long total = 0;
        for (JsonNode c : cells) total += c.get("count").asLong();
        return total;
    }

    @Test
    void activityFeedNamesStaffButNotCommuters() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        UUID hazard = reportAndAwaitHazard(alice, "PATH_OBSTRUCTION", freshLocation());
        expectStatus(mvc.perform(delete("/api/hazards/" + hazard).param("reason", "Duplicate: same as the Ayala report")
                .with(bearer(mod))).andReturn(), 200);

        JsonNode page = json(mvc.perform(get("/api/moderation/activity").param("hazardId", hazard.toString())
                .with(bearer(mod))).andReturn(), 200);
        List<String> actions = page.get("items").findValuesAsText("action");
        assertThat(actions).contains("CREATED", "MODERATOR_REMOVED");
        assertThat(actions.get(0)).isNotEqualTo("CREATED"); // newest first
        for (JsonNode entry : page.get("items")) {
            String kind = entry.at("/actor/kind").asText();
            if (entry.get("action").asText().equals("CREATED")) {
                assertThat(kind).isEqualTo("REPORTER");
                assertThat(entry.at("/actor/name").isNull()).isTrue();
            }
            if (entry.get("action").asText().equals("MODERATOR_REMOVED")) {
                assertThat(kind).isEqualTo("STAFF");
                assertThat(entry.at("/actor/email").asText()).isEqualTo(mod.email());
                assertThat(entry.get("note").asText()).isEqualTo("Duplicate: same as the Ayala report");
            }
        }

        JsonNode staff = json(mvc.perform(get("/api/moderation/activity").param("hazardId", hazard.toString())
                .param("staffOnly", "true").with(bearer(mod))).andReturn(), 200);
        assertThat(staff.get("items").findValuesAsText("kind")).containsOnly("STAFF");
    }

    @Test
    void removingNeedsAReason() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        UUID hazard = reportAndAwaitHazard(alice, "FLOODING", freshLocation());
        json(mvc.perform(delete("/api/hazards/" + hazard).with(bearer(mod))).andReturn(), 400);
        json(mvc.perform(delete("/api/hazards/" + hazard).param("reason", "  ").with(bearer(mod))).andReturn(), 400);
        assertThat(hazardDetail(alice, hazard).at("/hazard/status").asText()).isEqualTo("REPORTED");
    }

    private List<UUID> queue(TestUser mod, String... params) throws Exception {
        var request = get("/api/moderation/hazards").with(bearer(mod));
        for (int i = 0; i < params.length; i += 2) request = request.param(params[i], params[i + 1]);
        JsonNode page = json(mvc.perform(request).andReturn(), 200);
        return page.get("items").findValuesAsText("id").stream().map(UUID::fromString).toList();
    }

    private JsonNode stats(TestUser mod) throws Exception {
        return json(mvc.perform(get("/api/moderation/stats").with(bearer(mod))).andReturn(), 200);
    }

    private void resolve(TestUser mod, UUID hazard) throws Exception {
        expectStatus(mvc.perform(post("/api/hazards/" + hazard + "/resolve").with(bearer(mod))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("note", "Fixed")))).andReturn(), 202);
        awaitJson(get("/api/hazards/" + hazard).with(bearer(mod)), n -> "RESOLVED".equals(n.at("/hazard/status").asText()));
    }

    private static String bbox(Location at, double meters) {
        Location sw = at.offsetMeters(-meters, -meters);
        Location ne = at.offsetMeters(meters, meters);
        return sw.lat() + "," + sw.lon() + "," + ne.lat() + "," + ne.lon();
    }
}
