package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

class HazardQueryIntegrationTest extends IntegrationTestBase {

    @Test
    void reportIsQueuedThenCreatedAndFoundByNearbyAndBbox() throws Exception {
        TestUser user = registerUser();
        Location at = freshLocation();
        UUID submissionId = submit(user, Map.of("type", "FLOODING", "latitude", at.lat(), "longitude", at.lon(),
                "severityAnswer", "KNEE_OR_HIGHER", "description", "Knee-deep near the corner"));

        JsonNode submission = awaitSubmission(user, submissionId);
        assertThat(submission.get("status").asText()).isEqualTo("CREATED");
        UUID hazardId = UUID.fromString(submission.get("hazardId").asText());

        JsonNode detail = hazardDetail(user, hazardId);
        assertThat(detail.at("/hazard/status").asText()).isEqualTo("REPORTED");
        assertThat(detail.at("/hazard/severity").asText()).isEqualTo("HIGH");
        assertThat(detail.at("/hazard/confidence").asText()).isEqualTo("UNCONFIRMED");
        assertThat(detail.at("/viewer/isReporter").asBoolean()).isTrue();
        assertThat(detail.at("/hazard/expiresAt").asText()).isNotBlank();

        JsonNode nearby = json(mvc.perform(get("/api/hazards/nearby").with(bearer(user))
                .param("lat", String.valueOf(at.lat())).param("lon", String.valueOf(at.lon()))
                .param("radiusMeters", "100")).andReturn(), 200);
        assertThat(nearby.findValuesAsText("id")).contains(hazardId.toString());

        JsonNode bbox = json(mvc.perform(get("/api/hazards/in-bbox").with(bearer(user))
                .param("minLat", String.valueOf(at.lat() - 0.001)).param("minLon", String.valueOf(at.lon() - 0.001))
                .param("maxLat", String.valueOf(at.lat() + 0.001)).param("maxLon", String.valueOf(at.lon() + 0.001)))
                .andReturn(), 200);
        assertThat(bbox.findValuesAsText("id")).contains(hazardId.toString());

        JsonNode history = json(mvc.perform(get("/api/hazards/" + hazardId + "/history").with(bearer(user))).andReturn(), 200);
        assertThat(history.get(0).get("action").asText()).isEqualTo("CREATED");
        assertThat(history.get(0).get("actor").asText()).isEqualTo("REPORTER");
    }

    @Test
    void myReportsListsSubmissionsWithCanonicalHazard() throws Exception {
        TestUser user = registerUser();
        UUID hazardId = reportAndAwaitHazard(user, "POOR_LIGHTING", freshLocation());
        JsonNode page = json(mvc.perform(get("/api/me/reports").with(bearer(user))).andReturn(), 200);
        assertThat(page.get("totalItems").asInt()).isEqualTo(1);
        assertThat(page.at("/items/0/submission/status").asText()).isEqualTo("CREATED");
        assertThat(page.at("/items/0/hazard/id").asText()).isEqualTo(hazardId.toString());
        assertThat(page.at("/items/0/mergedIntoExisting").asBoolean()).isFalse();
    }

    @Test
    void invalidQueriesAreRejected() throws Exception {
        TestUser user = registerUser();
        JsonNode badLat = json(mvc.perform(get("/api/hazards/nearby").with(bearer(user))
                .param("lat", "95").param("lon", "121")).andReturn(), 400);
        assertThat(badLat.get("error").asText()).isEqualTo("INVALID_COORDINATES");
        json(mvc.perform(get("/api/hazards/nearby").with(bearer(user))
                .param("lat", "14.55").param("lon", "121").param("radiusMeters", "20000")).andReturn(), 400);
        json(mvc.perform(get("/api/hazards/nearby").with(bearer(user))
                .param("lat", "14.55").param("lon", "121").param("limit", "1000")).andReturn(), 400);
        json(mvc.perform(get("/api/hazards/nearby").with(bearer(user))
                .param("lat", "14.55").param("lon", "121").param("types", "LAVA")).andReturn(), 400);
        // Reversed and oversized bounding boxes.
        json(mvc.perform(get("/api/hazards/in-bbox").with(bearer(user))
                .param("minLat", "14.6").param("minLon", "121").param("maxLat", "14.5").param("maxLon", "121.1")).andReturn(), 400);
        json(mvc.perform(get("/api/hazards/in-bbox").with(bearer(user))
                .param("minLat", "10").param("minLon", "115").param("maxLat", "20").param("maxLon", "125")).andReturn(), 400);
    }

    @Test
    void frameworkErrorsKeepTheirStatusInsteadOf500() throws Exception {
        TestUser user = registerUser();
        JsonNode unsupported = json(mvc.perform(post("/api/hazard-submissions").with(bearer(user))
                .contentType(MediaType.APPLICATION_FORM_URLENCODED).content("type=FLOODING")).andReturn(), 415);
        assertThat(unsupported.get("error").asText()).isEqualTo("UNSUPPORTED_MEDIA_TYPE");
        json(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/hazard-submissions")
                .with(bearer(user))).andReturn(), 405);
        json(mvc.perform(get("/api/does-not-exist").with(bearer(user))).andReturn(), 404);
    }

    @Test
    void reportsOutsideCoverageAreaAreRejected() throws Exception {
        TestUser user = registerUser();
        JsonNode body = json(mvc.perform(post("/api/hazard-submissions").with(bearer(user)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("type", "FLOODING", "latitude", 37.3349, "longitude", -122.0090)))).andReturn(), 422);
        assertThat(body.get("error").asText()).isEqualTo("OUTSIDE_COVERAGE_AREA");
    }

    @Test
    void invalidSeverityAnswerIsRejected() throws Exception {
        TestUser user = registerUser();
        Location at = freshLocation();
        JsonNode body = json(mvc.perform(post("/api/hazard-submissions").with(bearer(user)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("type", "FLOODING", "latitude", at.lat(), "longitude", at.lon(),
                        "severityAnswer", "COMPLETELY_UNLIT")))).andReturn(), 400);
        assertThat(body.get("error").asText()).isEqualTo("INVALID_SEVERITY_ANSWER");
    }

    @Test
    void submissionsAreOnlyVisibleToTheirOwner() throws Exception {
        TestUser owner = registerUser();
        TestUser other = registerUser();
        UUID submissionId = submit(owner, "OPEN_MANHOLE", freshLocation());
        json(mvc.perform(get("/api/hazard-submissions/" + submissionId).with(bearer(other))).andReturn(), 404);
    }

    @Test
    void eleventhReportInAnHourReturns429() throws Exception {
        TestUser user = registerUser();
        for (int i = 0; i < 10; i++) submit(user, "BROKEN_SIDEWALK", freshLocation());
        Location at = freshLocation();
        JsonNode body = json(mvc.perform(post("/api/hazard-submissions").with(bearer(user)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("type", "BROKEN_SIDEWALK", "latitude", at.lat(), "longitude", at.lon())))).andReturn(), 429);
        assertThat(body.get("retryAfterSeconds").asLong()).isPositive();
    }
}
