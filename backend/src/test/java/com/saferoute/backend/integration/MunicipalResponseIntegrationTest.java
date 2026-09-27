package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class MunicipalResponseIntegrationTest extends IntegrationTestBase {

    @Test
    void staffAssignADepartmentAndPriorityThatEveryoneSees() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        Location at = freshLocation();
        UUID hazard = reportAndAwaitHazard(alice, "OPEN_MANHOLE", at);

        JsonNode updated = respond(mod, hazard, "engineering", "URGENT", "Crew dispatched", 200);
        assertThat(updated.get("assignedDepartment").asText()).isEqualTo("ENGINEERING");
        assertThat(updated.get("municipalPriority").asText()).isEqualTo("URGENT");
        assertThat(updated.get("assignedAt").asText()).isNotBlank();

        // Commuters see the city response on the hazard itself.
        JsonNode seen = hazardDetail(alice, hazard).get("hazard");
        assertThat(seen.get("assignedDepartment").asText()).isEqualTo("ENGINEERING");
        assertThat(seen.get("municipalPriority").asText()).isEqualTo("URGENT");

        JsonNode timeline = json(mvc.perform(get("/api/hazards/" + hazard + "/history").with(bearer(alice))).andReturn(), 200);
        assertThat(timeline.findValuesAsText("action")).contains("MUNICIPAL_ASSIGNED", "MUNICIPAL_PRIORITY");
        for (JsonNode entry : timeline) {
            if (entry.get("action").asText().startsWith("MUNICIPAL_")) assertThat(entry.get("actor").asText()).isEqualTo("MODERATOR");
        }

        // Clearing both.
        JsonNode cleared = respond(mod, hazard, null, null, null, 200);
        assertThat(cleared.get("assignedDepartment").isNull()).isTrue();
        assertThat(cleared.get("assignedAt").isNull()).isTrue();

        JsonNode departments = json(mvc.perform(get("/api/meta/departments").with(bearer(alice))).andReturn(), 200);
        assertThat(departments.findValuesAsText("code")).contains("ENGINEERING", "PUBLIC_SAFETY");
    }

    @Test
    void onlyStaffRespondAndDepartmentsMustExist() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        UUID hazard = reportAndAwaitHazard(alice, "FLOODING", freshLocation());
        respond(alice, hazard, "ENGINEERING", "HIGH", null, 403);
        JsonNode body = respond(mod, hazard, "PARKS", "HIGH", null, 400);
        assertThat(body.get("error").asText()).isEqualTo("UNKNOWN_DEPARTMENT");
    }

    @Test
    void queueFiltersByDepartmentAndSortsByPriority() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        Location at = freshLocation();
        UUID urgent = reportAndAwaitHazard(alice, "OPEN_MANHOLE", at);
        UUID low = reportAndAwaitHazard(alice, "POOR_LIGHTING", at.offsetMeters(0, 60));
        UUID unassigned = reportAndAwaitHazard(alice, "BROKEN_SIDEWALK", at.offsetMeters(0, 120));
        respond(mod, urgent, "ENGINEERING", "URGENT", null, 200);
        respond(mod, low, "BARANGAY_OFFICE", "LOW", null, 200);
        String box = bbox(at);

        assertThat(queue(mod, "bbox", box, "departments", "ENGINEERING")).containsExactly(urgent);
        assertThat(queue(mod, "bbox", box, "departments", "UNASSIGNED")).containsExactly(unassigned);
        assertThat(queue(mod, "bbox", box, "departments", "UNASSIGNED,BARANGAY_OFFICE")).containsExactlyInAnyOrder(low, unassigned);
        assertThat(queue(mod, "bbox", box, "view", "unassigned")).containsExactly(unassigned);
        assertThat(queue(mod, "bbox", box, "priorities", "URGENT,HIGH")).containsExactly(urgent);
        assertThat(queue(mod, "bbox", box, "sort", "priority")).containsExactly(urgent, low, unassigned);
        json(mvc.perform(get("/api/moderation/hazards").param("departments", "PARKS").with(bearer(mod))).andReturn(), 400);
    }

    @Test
    void savedViewsBelongToTheirOwner() throws Exception {
        TestUser mod = registerModerator();
        TestUser other = registerModerator();
        JsonNode saved = saveView(mod, "Unresolved > 7 days", "{\"tab\":\"active\",\"sort\":\"oldest\"}");
        saveView(mod, "Unresolved > 7 days", "{\"tab\":\"active\",\"sort\":\"newest\"}"); // same name replaces

        JsonNode mine = json(mvc.perform(get("/api/moderation/saved-views").with(bearer(mod))).andReturn(), 200);
        assertThat(mine).hasSize(1);
        assertThat(mine.get(0).get("config").asText()).contains("newest");
        assertThat(json(mvc.perform(get("/api/moderation/saved-views").with(bearer(other))).andReturn(), 200)).isEmpty();

        String id = saved.get("id").asText();
        expectStatus(mvc.perform(delete("/api/moderation/saved-views/" + id).with(bearer(other))).andReturn(), 404);
        expectStatus(mvc.perform(delete("/api/moderation/saved-views/" + id).with(bearer(mod))).andReturn(), 204);
        assertThat(json(mvc.perform(get("/api/moderation/saved-views").with(bearer(mod))).andReturn(), 200)).isEmpty();
    }

    private JsonNode respond(TestUser user, UUID hazard, String department, String priority, String note, int status) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("department", department);
        body.put("priority", priority);
        body.put("note", note);
        return json(mvc.perform(put("/api/moderation/hazards/" + hazard + "/response").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(body))).andReturn(), status);
    }

    private JsonNode saveView(TestUser user, String name, String config) throws Exception {
        return json(mvc.perform(post("/api/moderation/saved-views").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("name", name, "config", config)))).andReturn(), 200);
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
