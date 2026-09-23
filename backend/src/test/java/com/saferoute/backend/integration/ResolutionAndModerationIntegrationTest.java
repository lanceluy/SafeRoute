package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.hazard.HazardExpiryService;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class ResolutionAndModerationIntegrationTest extends IntegrationTestBase {

    @Autowired
    HazardExpiryService expiryService;

    @Test
    void normalUsersCannotResolveReopenOrDelete() throws Exception {
        TestUser alice = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "OPEN_MANHOLE", freshLocation());
        JsonNode body = json(mvc.perform(post("/api/hazards/" + hazardId + "/resolve").with(bearer(alice))).andReturn(), 403);
        assertThat(body.get("error").asText()).isEqualTo("FORBIDDEN");
        json(mvc.perform(post("/api/hazards/" + hazardId + "/reopen").with(bearer(alice))).andReturn(), 403);
        json(mvc.perform(delete("/api/hazards/" + hazardId).with(bearer(alice))).andReturn(), 403);
        json(mvc.perform(get("/api/moderation/hazards").with(bearer(alice))).andReturn(), 403);
    }

    @Test
    void communityVotesResolveAHazard() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        TestUser carol = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "PATH_OBSTRUCTION", freshLocation());

        vote(bob, hazardId, "NO_LONGER_PRESENT");
        awaitJson(get("/api/hazards/" + hazardId).with(bearer(alice)), n -> n.at("/community/noLongerPresentVotes").asInt() == 1);
        assertThat(hazardDetail(alice, hazardId).at("/hazard/status").asText()).isEqualTo("REPORTED");

        vote(carol, hazardId, "NO_LONGER_PRESENT");
        JsonNode resolved = awaitHazard(alice, hazardId, h -> "RESOLVED".equals(h.get("status").asText()));
        assertThat(resolved.get("resolvedAt").asText()).isNotBlank();

        // Resolved hazards drop off the default (active) map query.
        JsonNode timeline = json(mvc.perform(get("/api/hazards/" + hazardId + "/history").with(bearer(alice))).andReturn(), 200);
        assertThat(timeline.findValuesAsText("action")).contains("RESOLUTION_VOTE", "STATUS_CHANGED");
    }

    @Test
    void moderatorCanResolveReopenAndRemove() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        UUID hazardId = reportAndAwaitHazard(alice, "CONSTRUCTION", freshLocation());

        expectStatus(mvc.perform(post("/api/hazards/" + hazardId + "/resolve").with(bearer(mod))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("note", "Crew finished")))).andReturn(), 202);
        awaitHazard(alice, hazardId, h -> "RESOLVED".equals(h.get("status").asText()));

        JsonNode reopened = json(mvc.perform(post("/api/hazards/" + hazardId + "/reopen").with(bearer(mod))).andReturn(), 200);
        assertThat(reopened.get("status").asText()).isEqualTo("REPORTED");

        JsonNode removed = json(mvc.perform(delete("/api/hazards/" + hazardId).param("reason", "Spam").with(bearer(mod))).andReturn(), 200);
        assertThat(removed.get("status").asText()).isEqualTo("REMOVED");
        JsonNode profile = json(mvc.perform(get("/api/me/profile").with(bearer(alice))).andReturn(), 200);
        assertThat(profile.get("reputationScore").asInt()).isEqualTo(-5);

        JsonNode timeline = json(mvc.perform(get("/api/hazards/" + hazardId + "/history").with(bearer(alice))).andReturn(), 200);
        assertThat(timeline.findValuesAsText("action")).contains("MODERATOR_RESOLVED", "MODERATOR_REOPENED", "MODERATOR_REMOVED");
        assertThat(timeline.findValuesAsText("actor")).contains("MODERATOR");
    }

    @Test
    void onlyReporterOrModeratorCanEditAndReporterEditsAreLimited() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = freshLocation();
        UUID hazardId = reportAndAwaitHazard(alice, "BROKEN_SIDEWALK", at);

        json(mvc.perform(patch("/api/hazards/" + hazardId).with(bearer(bob)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("description", "hijack")))).andReturn(), 403);

        JsonNode edited = json(mvc.perform(patch("/api/hazards/" + hazardId).with(bearer(alice)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("description", "Large crack by the curb", "severityAnswer", "BLOCKED")))).andReturn(), 200);
        assertThat(edited.get("description").asText()).isEqualTo("Large crack by the curb");
        assertThat(edited.get("severity").asText()).isEqualTo("HIGH");

        Location far = at.offsetMeters(200, 0);
        JsonNode tooFar = json(mvc.perform(patch("/api/hazards/" + hazardId).with(bearer(alice)).contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("latitude", far.lat(), "longitude", far.lon())))).andReturn(), 403);
        assertThat(tooFar.get("error").asText()).isEqualTo("MOVE_TOO_FAR");
    }

    @Test
    void staleHazardsExpire() throws Exception {
        TestUser alice = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "FLOODING", freshLocation());
        jdbc.update("UPDATE hazards SET expires_at = now() - interval '1 minute' WHERE id = ?", hazardId);

        expiryService.expireStaleHazards();

        assertThat(hazardDetail(alice, hazardId).at("/hazard/status").asText()).isEqualTo("EXPIRED");
        json(mvc.perform(put("/api/hazards/" + hazardId + "/confirmation").with(bearer(registerUser()))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("action", "VERIFY")))).andReturn(), 409);
    }

    @Test
    void stillPresentVoteExtendsExpiry() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "OPEN_MANHOLE", freshLocation());
        jdbc.update("UPDATE hazards SET expires_at = now() + interval '1 hour' WHERE id = ?", hazardId);
        assertThat(hazardDetail(alice, hazardId).get("expiringSoon").asBoolean()).isTrue();

        vote(bob, hazardId, "STILL_PRESENT");
        awaitJson(get("/api/hazards/" + hazardId).with(bearer(alice)), n -> !n.get("expiringSoon").asBoolean());
    }

    private void vote(TestUser user, UUID hazardId, String action) throws Exception {
        expectStatus(mvc.perform(post("/api/hazards/" + hazardId + "/resolution-confirmation").with(bearer(user))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("action", action)))).andReturn(), 202);
    }
}
