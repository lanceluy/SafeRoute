package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.HazardReportedEvent;
import com.saferoute.backend.event.outbox.OutboxRelay;
import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** Accepted reports always reach an outcome, exactly once. */
class ReportingReliabilityIntegrationTest extends IntegrationTestBase {

    @Autowired
    OutboxRelay outboxRelay;

    @Test
    void retryingWithTheSameClientRequestIdReturnsTheOriginalSubmission() throws Exception {
        TestUser alice = registerUser();
        Location at = freshLocation();
        Map<String, Object> body = report("OPEN_MANHOLE", at, UUID.randomUUID());

        UUID first = submit(alice, body);
        MvcResult retry = mvc.perform(post("/api/hazard-submissions").with(bearer(alice))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(body))).andReturn();

        JsonNode replayed = json(retry, 200);
        assertThat(replayed.get("submissionId").asText()).isEqualTo(first.toString());
        awaitSubmission(alice, first);
        Integer submissions = jdbc.queryForObject("SELECT count(*) FROM hazard_submissions WHERE reporter_id = ?",
                Integer.class, alice.id());
        assertThat(submissions).isEqualTo(1);
    }

    @Test
    void reusingAClientRequestIdForDifferentContentIsRejected() throws Exception {
        TestUser alice = registerUser();
        UUID key = UUID.randomUUID();
        Location at = freshLocation();
        submit(alice, report("OPEN_MANHOLE", at, key));

        JsonNode conflict = json(mvc.perform(post("/api/hazard-submissions").with(bearer(alice))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(report("FLOODING", at, key)))).andReturn(), 409);
        assertThat(conflict.get("error").asText()).isEqualTo("IDEMPOTENCY_KEY_REUSED");
    }

    @Test
    void theSubmissionAndItsCommandAreCommittedTogether() throws Exception {
        TestUser alice = registerUser();
        UUID submissionId = submit(alice, "POOR_LIGHTING", freshLocation());

        Integer rows = jdbc.queryForObject("""
                SELECT count(*) FROM outbox_events WHERE topic = ? AND message_key = ?""",
                Integer.class, KafkaTopics.HAZARD_REPORTED, submissionId.toString());
        assertThat(rows).isEqualTo(1);
        assertThat(awaitSubmission(alice, submissionId).get("status").asText()).isEqualTo("CREATED");
    }

    /**
     * The crash window the outbox closes: the submission and its command committed, but the process
     * died before publishing. The relay's sweep publishes it later and the report is processed.
     */
    @Test
    void aCommandCommittedButNeverPublishedIsRecoveredByTheRelay() throws Exception {
        TestUser alice = registerUser();
        Location at = freshLocation();
        UUID submissionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO hazard_submissions (id, reporter_id, submitted_type, latitude, longitude, processing_status)
                VALUES (?, ?, 'CONSTRUCTION', ?, ?, 'QUEUED')""", submissionId, alice.id(), at.lat(), at.lon());
        var event = new HazardReportedEvent(EventMetadata.create(KafkaTopics.HAZARD_REPORTED), submissionId,
                HazardType.CONSTRUCTION, at.lat(), at.lon(), null, null, null, alice.id(), Instant.now());
        jdbc.update("""
                INSERT INTO outbox_events (event_id, topic, message_key, payload_type, payload)
                VALUES (?, ?, ?, ?, ?::jsonb)""", event.metadata().eventId(), KafkaTopics.HAZARD_REPORTED,
                submissionId.toString(), HazardReportedEvent.class.getName(), objectMapper.writeValueAsString(event));

        outboxRelay.drain(); // what the scheduled sweep does after a restart

        assertThat(awaitSubmission(alice, submissionId).get("status").asText()).isEqualTo("CREATED");
        await().atMost(Duration.ofSeconds(10)).until(() -> jdbc.queryForObject(
                "SELECT published_at IS NOT NULL FROM outbox_events WHERE event_id = ?", Boolean.class, event.metadata().eventId()));
    }

    @Test
    void anOfflineReportKeepsItsObservationTime() throws Exception {
        TestUser alice = registerUser();
        Instant seen = Instant.now().minus(Duration.ofHours(3));
        Map<String, Object> body = report("OPEN_MANHOLE", freshLocation(), UUID.randomUUID());
        body.put("observedAt", seen.toString());

        JsonNode result = awaitSubmission(alice, submit(alice, body));
        JsonNode hazard = hazardDetail(alice, UUID.fromString(result.get("hazardId").asText())).get("hazard");

        Instant lastConfirmed = Instant.parse(hazard.get("lastConfirmedAt").asText());
        assertThat(Duration.between(seen, lastConfirmed).abs()).isLessThan(Duration.ofSeconds(1));
    }

    @Test
    void aReportOlderThanItsTypesLifetimeIsRejected() throws Exception {
        TestUser alice = registerUser();
        Map<String, Object> body = report("FLOODING", freshLocation(), UUID.randomUUID());
        body.put("observedAt", Instant.now().minus(Duration.ofHours(13)).toString()); // flooding lasts 12 h

        JsonNode tooOld = json(mvc.perform(post("/api/hazard-submissions").with(bearer(alice))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(body))).andReturn(), 422);
        assertThat(tooOld.get("error").asText()).isEqualTo("REPORT_TOO_OLD");
    }

    private static Map<String, Object> report(String type, Location at, UUID clientRequestId) {
        Map<String, Object> body = new HashMap<>();
        body.put("type", type);
        body.put("latitude", at.lat());
        body.put("longitude", at.lon());
        body.put("clientRequestId", clientRequestId.toString());
        return body;
    }
}
