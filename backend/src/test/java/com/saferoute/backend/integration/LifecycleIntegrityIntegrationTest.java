package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.confirmation.ConfirmationAction;
import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.HazardVerifiedEvent;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.kafka.core.KafkaTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** Hazard identity, freshness and vote provenance. */
class LifecycleIntegrityIntegrationTest extends IntegrationTestBase {

    @Autowired
    KafkaTemplate<String, Object> kafkaTemplate;

    @Test
    void anOldButStillActiveHazardIsMergedNotDuplicated() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = freshLocation();
        UUID hazardId = reportAndAwaitHazard(alice, "BROKEN_SIDEWALK", at);
        // First reported four days ago; still active (broken sidewalks last 45 days).
        jdbc.update("UPDATE hazards SET created_at = now() - interval '4 days' WHERE id = ?", hazardId);

        JsonNode second = awaitSubmission(bob, submit(bob, "BROKEN_SIDEWALK", at.offsetMeters(5, 5)));

        assertThat(second.get("status").asText()).isEqualTo("MERGED");
        assertThat(second.get("hazardId").asText()).isEqualTo(hazardId.toString());
    }

    @Test
    void aSameTypeHazardOutsideTheDuplicateRadiusStaysSeparate() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        Location at = freshLocation();
        UUID first = reportAndAwaitHazard(alice, "BROKEN_SIDEWALK", at);

        JsonNode other = awaitSubmission(bob, submit(bob, "BROKEN_SIDEWALK", at.offsetMeters(100, 0)));

        assertThat(other.get("status").asText()).isEqualTo("CREATED");
        assertThat(other.get("hazardId").asText()).isNotEqualTo(first.toString());
    }

    @Test
    void changingTheTypeRecomputesExpiryFromTheLastSighting() throws Exception {
        TestUser alice = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "ACCESSIBILITY_BARRIER", freshLocation());

        JsonNode edited = json(mvc.perform(patch("/api/hazards/" + hazardId).with(bearer(alice))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("type", "FLOODING")))).andReturn(), 200);

        Instant lastConfirmed = Instant.parse(edited.get("lastConfirmedAt").asText());
        Instant expiresAt = Instant.parse(edited.get("expiresAt").asText());
        // Flooding's 12 hours, not the barrier's 90 days.
        assertThat(Duration.between(lastConfirmed, expiresAt).toMinutes()).isCloseTo(12 * 60, within(1L));
    }

    @Test
    void aSingleCommunityOpinionLocksTheReportersStructuralEdits() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "BROKEN_SIDEWALK", freshLocation());
        confirm(bob, hazardId, "VERIFY");
        awaitHazard(alice, hazardId, h -> h.get("confirmationCount").asInt() == 1);

        JsonNode refused = json(mvc.perform(patch("/api/hazards/" + hazardId).with(bearer(alice))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("type", "FLOODING")))).andReturn(), 403);
        assertThat(refused.get("error").asText()).isEqualTo("EDIT_LOCKED");

        // Non-structural edits stay open.
        json(mvc.perform(patch("/api/hazards/" + hazardId).with(bearer(alice))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("description", "Cracked slab")))).andReturn(), 200);
    }

    @Test
    void aCommandAcceptedAgainstOldContentIsNotApplied() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        TestUser carol = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "BROKEN_SIDEWALK", freshLocation());
        // Alice changes the type while it is still unconfirmed: the content moves to revision 1.
        json(mvc.perform(patch("/api/hazards/" + hazardId).with(bearer(alice))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("type", "PATH_OBSTRUCTION")))).andReturn(), 200);

        // Bob's VERIFY was accepted while the hazard was still revision 0 (a broken sidewalk).
        var stale = new HazardVerifiedEvent(EventMetadata.create(KafkaTopics.HAZARD_VERIFIED), hazardId, bob.id(),
                ConfirmationAction.VERIFY, 0);
        kafkaTemplate.send(KafkaTopics.HAZARD_VERIFIED, hazardId.toString(), stale).get();
        confirm(carol, hazardId, "DISPUTE"); // barrier: same partition, processed after the stale command
        awaitHazard(alice, hazardId, h -> h.get("disputeCount").asInt() == 1);

        assertThat(hazardDetail(alice, hazardId).at("/hazard/confirmationCount").asInt()).isZero();
        Integer revision = jdbc.queryForObject(
                "SELECT hazard_revision FROM hazard_confirmations WHERE hazard_id = ? AND user_id = ?",
                Integer.class, hazardId, carol.id());
        assertThat(revision).isEqualTo(1);
    }

    @Test
    void repeatingVerifyRefreshesFreshnessWithoutAddingAVote() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        TestUser carol = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "OPEN_MANHOLE", freshLocation());
        confirm(bob, hazardId, "VERIFY");
        awaitHazard(alice, hazardId, h -> h.get("confirmationCount").asInt() == 1);
        jdbc.update("UPDATE hazards SET expires_at = now() + interval '1 hour' WHERE id = ?", hazardId);

        confirm(bob, hazardId, "VERIFY");               // a fresh sighting by the same person
        confirm(carol, hazardId, "DISPUTE");            // barrier
        JsonNode hazard = awaitHazard(alice, hazardId, h -> h.get("disputeCount").asInt() == 1);

        assertThat(hazard.get("confirmationCount").asInt()).isEqualTo(1);
        Instant expiresAt = Instant.parse(hazard.get("expiresAt").asText());
        assertThat(expiresAt).isAfter(Instant.now().plus(Duration.ofDays(6)));
    }

    @Test
    void reopeningStartsANewRevisionSoEarlierVotesCannotActOnIt() throws Exception {
        TestUser alice = registerUser();
        TestUser mod = registerModerator();
        UUID hazardId = reportAndAwaitHazard(alice, "OPEN_MANHOLE", freshLocation());
        expectStatus(mvc.perform(post("/api/hazards/" + hazardId + "/resolve").with(bearer(mod))).andReturn(), 202);
        awaitHazard(alice, hazardId, h -> "RESOLVED".equals(h.get("status").asText()));
        json(mvc.perform(post("/api/hazards/" + hazardId + "/reopen").with(bearer(mod))).andReturn(), 200);

        Integer revision = jdbc.queryForObject("SELECT content_revision FROM hazards WHERE id = ?", Integer.class, hazardId);
        assertThat(revision).isEqualTo(1);
    }
}
