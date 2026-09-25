package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.hazard.HazardController;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** A route assessment must see every hazard on the path, or say that it could not. */
class RouteAssessmentIntegrationTest extends IntegrationTestBase {

    /** A quiet corner of the coverage area no other test reports into. */
    private static final Location ORIGIN = new Location(14.70, 121.10);

    @Test
    void anOldHazardOnThePathIsFoundDespiteManyNewerOnesNearby() throws Exception {
        TestUser alice = registerUser();
        Location start = ORIGIN;
        Location end = ORIGIN.offsetMeters(0, 800);
        Location onPath = ORIGIN.offsetMeters(0, 400);
        UUID old = insertHazard(alice, onPath, "OPEN_MANHOLE", "HIGH", "now() - interval '5 days'");
        for (int i = 0; i < 300; i++) {
            // Newer hazards 150–300 m off the path, all inside the same map viewport.
            insertHazard(alice, ORIGIN.offsetMeters(150 + (i % 10) * 15, (i / 10) * 25), "POOR_LIGHTING", "LOW", "now()");
        }

        JsonNode assessment = alongRoute(List.of(List.of(start, end)));
        assertThat(ids(assessment)).contains(old.toString());
        assertThat(assessment.get("complete").asBoolean()).isTrue();

        // The recency-ordered viewport query can't hold them all, and says so.
        MvcResult bbox = mvc.perform(get("/api/hazards/in-bbox").with(bearer(alice))
                .param("minLat", String.valueOf(ORIGIN.lat() - 0.01)).param("minLon", String.valueOf(ORIGIN.lon() - 0.01))
                .param("maxLat", String.valueOf(ORIGIN.lat() + 0.01)).param("maxLon", String.valueOf(ORIGIN.lon() + 0.02))
                .param("limit", "250")).andReturn();
        expectStatus(bbox, 200);
        assertThat(bbox.getResponse().getHeader(HazardController.TRUNCATED_HEADER)).isEqualTo("true");
        assertThat(ids(objectMapper.readTree(bbox.getResponse().getContentAsString()))).doesNotContain(old.toString());
    }

    @Test
    void aRouteLeavingThePilotAreaIsReportedIncomplete() throws Exception {
        registerUser();
        Location inside = new Location(14.79, 121.14);
        Location outside = new Location(14.83, 121.14); // north of the coverage box

        JsonNode assessment = alongRoute(List.of(List.of(inside, outside)));

        assertThat(assessment.get("complete").asBoolean()).isFalse();
        assertThat(assessment.get("leavesCoverageArea").asBoolean()).isTrue();
    }

    private JsonNode alongRoute(List<List<Location>> routes) throws Exception {
        TestUser viewer = registerUser();
        List<List<double[]>> body = new ArrayList<>();
        for (List<Location> route : routes) {
            body.add(route.stream().map(l -> new double[]{l.lat(), l.lon()}).toList());
        }
        return json(mvc.perform(post("/api/hazards/along-route").with(bearer(viewer))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("routes", body)))).andReturn(), 200);
    }

    private UUID insertHazard(TestUser reporter, Location at, String type, String severity, String updatedAtSql) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO hazards (id, type, location, severity, reporter_id, expires_at, last_confirmed_at, "
                        + "created_at, updated_at) VALUES (?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?, ?, "
                        + "now() + interval '7 days', now(), " + updatedAtSql + ", " + updatedAtSql + ")",
                id, type, at.lon(), at.lat(), severity, reporter.id());
        return id;
    }

    private static List<String> ids(JsonNode node) {
        JsonNode list = node.has("hazards") ? node.get("hazards") : node;
        List<String> ids = new ArrayList<>();
        list.forEach(h -> ids.add(h.get("id").asText()));
        return ids;
    }
}
