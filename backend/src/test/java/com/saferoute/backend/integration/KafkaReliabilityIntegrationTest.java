package com.saferoute.backend.integration;

import com.saferoute.backend.confirmation.ConfirmationAction;
import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.HazardReportedEvent;
import com.saferoute.backend.event.dto.HazardVerifiedEvent;
import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.support.IntegrationTestBase;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

class KafkaReliabilityIntegrationTest extends IntegrationTestBase {

    @Autowired
    KafkaTemplate<String, Object> kafkaTemplate;

    @Value("${spring.kafka.bootstrap-servers}")
    String bootstrapServers;

    @Test
    void redeliveredConfirmationIsAppliedOnce() throws Exception {
        TestUser alice = registerUser();
        TestUser bob = registerUser();
        TestUser carol = registerUser();
        UUID hazardId = reportAndAwaitHazard(alice, "OPEN_MANHOLE", freshLocation());

        var event = new HazardVerifiedEvent(EventMetadata.create(KafkaTopics.HAZARD_VERIFIED), hazardId, bob.id(), ConfirmationAction.VERIFY);
        kafkaTemplate.send(KafkaTopics.HAZARD_VERIFIED, hazardId.toString(), event).get();
        kafkaTemplate.send(KafkaTopics.HAZARD_VERIFIED, hazardId.toString(), event).get(); // redelivery
        // A later, distinct event acts as a barrier: once it is applied, both copies above were consumed.
        confirm(carol, hazardId, "DISPUTE");
        awaitHazard(alice, hazardId, h -> h.get("disputeCount").asInt() == 1);

        assertThat(hazardDetail(alice, hazardId).at("/hazard/confirmationCount").asInt()).isEqualTo(1);
        Integer processed = jdbc.queryForObject("SELECT count(*) FROM processed_events WHERE event_id = ?",
                Integer.class, event.metadata().eventId());
        assertThat(processed).isEqualTo(1);
    }

    @Test
    void redeliveredReportDoesNotCreateASecondHazard() throws Exception {
        TestUser alice = registerUser();
        Location at = freshLocation();
        UUID submissionId = submit(alice, "POOR_LIGHTING", at);
        var submission = awaitSubmission(alice, submissionId);

        // Replay the same submission under a *new* event id (e.g. a producer retry after a timeout):
        // the submission's terminal status still prevents a duplicate side effect.
        var replay = new HazardReportedEvent(EventMetadata.create(KafkaTopics.HAZARD_REPORTED), submissionId,
                HazardType.POOR_LIGHTING, at.lat(), at.lon(), null, null, null, alice.id());
        kafkaTemplate.send(KafkaTopics.HAZARD_REPORTED, submissionId.toString(), replay).get();
        await().atMost(Duration.ofSeconds(20)).until(() -> Integer.valueOf(1).equals(jdbc.queryForObject(
                "SELECT count(*) FROM processed_events WHERE event_id = ?", Integer.class, replay.metadata().eventId())));

        Integer hazards = jdbc.queryForObject("SELECT count(*) FROM hazards WHERE reporter_id = ?", Integer.class, alice.id());
        assertThat(hazards).isEqualTo(1);
        assertThat(submission.get("status").asText()).isEqualTo("CREATED");
    }

    @Test
    void invalidReportIsDeadLetteredAndSubmissionMarkedFailed() throws Exception {
        TestUser alice = registerUser();
        UUID submissionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO hazard_submissions (id, reporter_id, submitted_type, latitude, longitude, processing_status)
                VALUES (?, ?, 'FLOODING', 14.55, 121.02, 'QUEUED')""", submissionId, alice.id());

        var poison = new HazardReportedEvent(EventMetadata.create(KafkaTopics.HAZARD_REPORTED), submissionId,
                HazardType.FLOODING, 999, 121.02, null, null, null, alice.id());
        kafkaTemplate.send(KafkaTopics.HAZARD_REPORTED, submissionId.toString(), poison).get();

        var failed = awaitSubmission(alice, submissionId);
        assertThat(failed.get("status").asText()).isEqualTo("FAILED");
        assertThat(failed.get("failureReason").asText()).isNotBlank();
    }

    @Test
    void unparseableRecordLandsInDeadLetterTopic() throws Exception {
        String key = "poison-" + UUID.randomUUID();
        try (var producer = new KafkaProducer<String, String>(Map.of(
                ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers,
                ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
                ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class))) {
            producer.send(new ProducerRecord<>(KafkaTopics.HAZARD_VERIFIED, key, "{not json")).get();
        }
        try (var consumer = new KafkaConsumer<String, byte[]>(Map.of(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers,
                ConsumerConfig.GROUP_ID_CONFIG, "dlq-test-" + UUID.randomUUID(),
                ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class))) {
            consumer.subscribe(List.of(KafkaTopics.HAZARD_VERIFIED + KafkaTopics.DLQ_SUFFIX));
            Instant deadline = Instant.now().plusSeconds(30);
            boolean found = false;
            while (!found && Instant.now().isBefore(deadline)) {
                for (var record : consumer.poll(Duration.ofMillis(500))) {
                    if (key.equals(record.key())) {
                        assertThat(new String(record.value(), StandardCharsets.UTF_8)).isEqualTo("{not json");
                        found = true;
                    }
                }
            }
            assertThat(found).as("poison record reached hazard_verified.dlq").isTrue();
        }
    }
}
