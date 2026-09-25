package com.saferoute.backend.config;

import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.NonRetryableEventException;
import com.saferoute.backend.metrics.SafeRouteMetrics;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.kafka.KafkaProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaOperations;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.CommonErrorHandler;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.listener.RetryListener;
import org.springframework.util.backoff.FixedBackOff;

import java.util.LinkedHashMap;
import java.util.Map;

@Configuration
public class KafkaConfig {

    private static final Logger log = LoggerFactory.getLogger(KafkaConfig.class);
    private static final int PARTITIONS = 3;
    private static final short REPLICATION_FACTOR = 1; // single-broker local dev
    private static final long RETRY_INTERVAL_MS = 500;
    private static final long RETRY_ATTEMPTS = 2; // 1 delivery + 2 retries, then DLQ
    private static final long DLQ_RETRY_INTERVAL_MS = 5_000;
    private static final long DLQ_RETRY_ATTEMPTS = 12;

    @Bean public NewTopic hazardReportedTopic() { return topic(KafkaTopics.HAZARD_REPORTED); }
    @Bean public NewTopic hazardVerifiedTopic() { return topic(KafkaTopics.HAZARD_VERIFIED); }
    @Bean public NewTopic hazardResolutionRequestedTopic() { return topic(KafkaTopics.HAZARD_RESOLUTION_REQUESTED); }
    @Bean public NewTopic hazardResolvedTopic() { return topic(KafkaTopics.HAZARD_RESOLVED); }
    @Bean public NewTopic hazardCreatedTopic() { return topic(KafkaTopics.HAZARD_CREATED); }
    @Bean public NewTopic hazardUpdatedTopic() { return topic(KafkaTopics.HAZARD_UPDATED); }
    @Bean public NewTopic submissionProcessedTopic() { return topic(KafkaTopics.SUBMISSION_PROCESSED); }

    // Dead-letter topics mirror their source's partitioning (the recoverer keeps the partition).
    @Bean public NewTopic hazardReportedDlq() { return topic(KafkaTopics.HAZARD_REPORTED + KafkaTopics.DLQ_SUFFIX); }
    @Bean public NewTopic hazardVerifiedDlq() { return topic(KafkaTopics.HAZARD_VERIFIED + KafkaTopics.DLQ_SUFFIX); }
    @Bean public NewTopic hazardResolutionRequestedDlq() { return topic(KafkaTopics.HAZARD_RESOLUTION_REQUESTED + KafkaTopics.DLQ_SUFFIX); }
    @Bean public NewTopic hazardResolvedDlq() { return topic(KafkaTopics.HAZARD_RESOLVED + KafkaTopics.DLQ_SUFFIX); }
    @Bean public NewTopic hazardCreatedDlq() { return topic(KafkaTopics.HAZARD_CREATED + KafkaTopics.DLQ_SUFFIX); }
    @Bean public NewTopic hazardUpdatedDlq() { return topic(KafkaTopics.HAZARD_UPDATED + KafkaTopics.DLQ_SUFFIX); }
    @Bean public NewTopic submissionProcessedDlq() { return topic(KafkaTopics.SUBMISSION_PROCESSED + KafkaTopics.DLQ_SUFFIX); }

    private static NewTopic topic(String name) {
        return TopicBuilder.name(name).partitions(PARTITIONS).replicas(REPLICATION_FACTOR).build();
    }

    /**
     * Retry, then dead-letter. Transient failures (optimistic-lock conflicts, a
     * unique-constraint race, a DB blip) get two more attempts; events that can never succeed
     * ({@link NonRetryableEventException}, deserialization errors) go straight to
     * {@code <topic>.dlq}.
     */
    @Bean
    public CommonErrorHandler kafkaErrorHandler(KafkaTemplate<String, Object> jsonTemplate,
                                                KafkaProperties kafkaProperties,
                                                SafeRouteMetrics metrics) {
        Map<Class<?>, KafkaOperations<?, ?>> templates = new LinkedHashMap<>();
        templates.put(byte[].class, bytesTemplate(kafkaProperties)); // undeserializable poison records
        templates.put(Object.class, jsonTemplate);
        var recoverer = new DeadLetterPublishingRecoverer(templates,
                (ConsumerRecord<?, ?> record, Exception ex) ->
                        new TopicPartition(record.topic() + KafkaTopics.DLQ_SUFFIX, record.partition()));

        var handler = new DefaultErrorHandler(recoverer, new FixedBackOff(RETRY_INTERVAL_MS, RETRY_ATTEMPTS));
        handler.addNotRetryableExceptions(NonRetryableEventException.class);
        handler.setRetryListeners(new RetryListener() {
            @Override
            public void failedDelivery(ConsumerRecord<?, ?> record, Exception ex, int deliveryAttempt) {
                metrics.consumerError();
                log.warn("Delivery attempt {} failed for {}-{}@{}: {}", deliveryAttempt,
                        record.topic(), record.partition(), record.offset(), ex.getMessage());
            }

            @Override
            public void recovered(ConsumerRecord<?, ?> record, Exception ex) {
                log.error("Sent {}-{}@{} to dead-letter topic: {}", record.topic(), record.partition(), record.offset(), ex.getMessage());
            }
        });
        return handler;
    }

    /**
     * The DLQ monitors must never dead-letter their own failures (that would loop). A failure is
     * usually transient (the database was briefly unavailable), so it is retried for about a
     * minute before the record is logged and skipped.
     */
    @Bean
    public ConcurrentKafkaListenerContainerFactory<Object, Object> deadLetterListenerContainerFactory(
            ConsumerFactory<Object, Object> consumerFactory) {
        var factory = new ConcurrentKafkaListenerContainerFactory<Object, Object>();
        factory.setConsumerFactory(consumerFactory);
        factory.setCommonErrorHandler(new DefaultErrorHandler(
                (record, ex) -> log.error("Giving up on dead-letter record {}-{}@{}: {}",
                        record.topic(), record.partition(), record.offset(), ex.getMessage()),
                new FixedBackOff(DLQ_RETRY_INTERVAL_MS, DLQ_RETRY_ATTEMPTS)));
        return factory;
    }

    private static KafkaTemplate<byte[], byte[]> bytesTemplate(KafkaProperties kafkaProperties) {
        Map<String, Object> props = new LinkedHashMap<>(kafkaProperties.buildProducerProperties(null));
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        return new KafkaTemplate<>(new DefaultKafkaProducerFactory<>(props));
    }
}
