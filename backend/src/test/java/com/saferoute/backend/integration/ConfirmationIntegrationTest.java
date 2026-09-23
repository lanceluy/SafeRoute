package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

class ConfirmationIntegrationTest extends IntegrationTestBase {

    @Test
    void reporterCannotConfirmOwnReport() throws Exception {
        TestUser alice = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "OPEN_MANHOLE", freshLocation());
        for (String action : new String[]{"VERIFY", "DISPUTE"}) {
            JsonNode body = json(mvc.perform(put("/api/hazards/" + hazardId + "/confirmation").with(bearer(alice))
                    .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("action", action)))).andReturn(), 409);
            assertThat(body.get("error").asText()).isEqualTo("SELF_CONFIRMATION_NOT_ALLOWED");
        }
    }

    @Test
    void thresholdVerifiesAndRewardsReporter() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        TestUser carol = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "FLOODING", freshLocation());

        confirm(bob, hazardId, "VERIFY");
        awaitHazard(alice, hazardId, h -> h.get("confirmationCount").asInt() == 1 && "REPORTED".equals(h.get("status").asText()));
        confirm(carol, hazardId, "VERIFY");
        JsonNode hazard = awaitHazard(alice, hazardId, h -> "VERIFIED".equals(h.get("status").asText()));
        assertThat(hazard.get("confidence").asText()).isEqualTo("MEDIUM");

        JsonNode profile = json(mvc.perform(get("/api/me/profile").with(bearer(alice))).andReturn(), 200);
        assertThat(profile.get("reputationScore").asInt()).isEqualTo(5);
        assertThat(profile.at("/stats/reportsVerified").asInt()).isEqualTo(1);
        assertThat(profile.at("/recentActivity/0/reason").asText()).isEqualTo("REPORT_VERIFIED");
        JsonNode bobProfile = json(mvc.perform(get("/api/me/profile").with(bearer(bob))).andReturn(), 200);
        assertThat(bobProfile.get("reputationScore").asInt()).isEqualTo(2);
    }

    @Test
    void changingOpinionUpdatesTheSingleRowAndDisputesSurface() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        TestUser carol = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "POOR_LIGHTING", freshLocation());

        confirm(bob, hazardId, "VERIFY");
        awaitHazard(alice, hazardId, h -> h.get("confirmationCount").asInt() == 1);
        confirm(bob, hazardId, "DISPUTE"); // VERIFY -> DISPUTE
        JsonNode afterChange = awaitHazard(alice, hazardId, h -> h.get("disputeCount").asInt() == 1);
        assertThat(afterChange.get("confirmationCount").asInt()).isZero();

        Integer rows = jdbc.queryForObject("SELECT count(*) FROM hazard_confirmations WHERE hazard_id = ? AND user_id = ?",
                Integer.class, hazardId, bob.id());
        assertThat(rows).isEqualTo(1);

        confirm(carol, hazardId, "DISPUTE");
        JsonNode disputed = awaitHazard(alice, hazardId, h -> "DISPUTED".equals(h.get("status").asText()));
        assertThat(disputed.get("confidence").asText()).isEqualTo("CONTESTED");

        JsonNode detail = hazardDetail(bob, hazardId);
        assertThat(detail.at("/viewer/confirmation").asText()).isEqualTo("DISPUTE");
    }

    @Test
    void databaseForbidsTwoOpinionsFromOneUser() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "OPEN_MANHOLE", freshLocation());
        jdbc.update("INSERT INTO hazard_confirmations (hazard_id, user_id, action) VALUES (?, ?, 'VERIFY')", hazardId, bob.id());
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO hazard_confirmations (hazard_id, user_id, action) VALUES (?, ?, 'DISPUTE')", hazardId, bob.id()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
