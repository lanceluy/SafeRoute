package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

class DeduplicationIntegrationTest extends IntegrationTestBase {

    @Test
    void sameTypeCloseAndRecentMergesAndReconcilesToCanonicalHazard() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = freshLocation();
        UUID original = reportAndAwaitHazard(alice, "OPEN_MANHOLE", at);

        JsonNode second = awaitSubmission(bob, submit(bob, "OPEN_MANHOLE", at.offsetMeters(10, 5)));
        assertThat(second.get("status").asText()).isEqualTo("MERGED");
        assertThat(second.get("hazardId").asText()).isEqualTo(original.toString());

        JsonNode hazard = awaitHazard(alice, original, h -> h.get("confirmationCount").asInt() == 1);
        assertThat(hazard.get("status").asText()).isEqualTo("REPORTED");

        // Bob's "My Reports" shows the canonical hazard, flagged as merged.
        JsonNode page = json(mvc.perform(get("/api/me/reports").with(bearer(bob))).andReturn(), 200);
        assertThat(page.at("/items/0/hazard/id").asText()).isEqualTo(original.toString());
        assertThat(page.at("/items/0/mergedIntoExisting").asBoolean()).isTrue();

        Integer hazardsAtSpot = jdbc.queryForObject(
                "SELECT count(*) FROM hazards WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, 30)",
                Integer.class, at.lon(), at.lat());
        assertThat(hazardsAtSpot).isEqualTo(1);
    }

    @Test
    void reporterReReportingOwnHazardDoesNotSelfConfirm() throws Exception {
        TestUser alice = registerUser();
        Location at = freshLocation();
        UUID original = reportAndAwaitHazard(alice, "FLOODING", at);
        JsonNode again = awaitSubmission(alice, submit(alice, "FLOODING", at.offsetMeters(3, 0)));
        assertThat(again.get("status").asText()).isEqualTo("MERGED");
        assertThat(hazardDetail(alice, original).at("/hazard/confirmationCount").asInt()).isZero();
    }

    @Test
    void differentTypeDoesNotMerge() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = freshLocation();
        UUID first = reportAndAwaitHazard(alice, "OPEN_MANHOLE", at);
        UUID second = reportAndAwaitHazard(bob, "POOR_LIGHTING", at);
        assertThat(second).isNotEqualTo(first);
    }

    @Test
    void outsideDuplicateRadiusDoesNotMerge() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = freshLocation();
        UUID first = reportAndAwaitHazard(alice, "BROKEN_SIDEWALK", at);
        UUID second = reportAndAwaitHazard(bob, "BROKEN_SIDEWALK", at.offsetMeters(60, 0));
        assertThat(second).isNotEqualTo(first);
    }

    @Test
    void outsideLookbackWindowDoesNotMerge() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = freshLocation();
        UUID first = reportAndAwaitHazard(alice, "ACCESSIBILITY_BARRIER", at);
        jdbc.update("UPDATE hazards SET created_at = now() - interval '80 hours' WHERE id = ?", first);

        UUID second = reportAndAwaitHazard(bob, "ACCESSIBILITY_BARRIER", at);
        assertThat(second).isNotEqualTo(first);
    }
}
