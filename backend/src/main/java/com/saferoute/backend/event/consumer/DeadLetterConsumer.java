package com.saferoute.backend.event.consumer;

import com.saferoute.backend.event.EventContext;
import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.HazardReportedEvent;
import com.saferoute.backend.event.dto.SubmissionProcessedEvent;
import com.saferoute.backend.event.producer.HazardEventProducer;
import com.saferoute.backend.metrics.SafeRouteMetrics;
import com.saferoute.backend.submission.HazardSubmissionRepository;
import com.saferoute.backend.submission.SubmissionStatus;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Closes the loop for reports that exhausted their retries: the submission is marked FAILED and
 * the reporter is told, instead of the report silently disappearing.
 */
@Component
public class DeadLetterConsumer {

    private static final Logger log = LoggerFactory.getLogger(DeadLetterConsumer.class);
    private static final String USER_MESSAGE = "We couldn't process this report. Please try again.";

    private final HazardSubmissionRepository submissionRepository;
    private final HazardEventProducer eventProducer;
    private final SafeRouteMetrics metrics;

    public DeadLetterConsumer(HazardSubmissionRepository submissionRepository,
                              HazardEventProducer eventProducer,
                              SafeRouteMetrics metrics) {
        this.submissionRepository = submissionRepository;
        this.eventProducer = eventProducer;
        this.metrics = metrics;
    }

    @KafkaListener(topics = KafkaTopics.HAZARD_REPORTED + KafkaTopics.DLQ_SUFFIX,
            groupId = "dead-letter-monitor-group", containerFactory = "deadLetterListenerContainerFactory")
    @Transactional
    public void onDeadLetteredReport(ConsumerRecord<String, Object> record,
                                     @Header(name = KafkaHeaders.DLT_EXCEPTION_MESSAGE, required = false) String reason) {
        if (!(record.value() instanceof HazardReportedEvent event)) {
            log.error("Unparseable record in {} (key={}): {}", record.topic(), record.key(), reason);
            return;
        }
        try (var ignored = EventContext.enter(event.metadata())) {
            UUID submissionId = event.submissionId();
            UUID reporterId = event.reporterUserId();
            // Conditional: a submission that already reached an outcome is never overwritten.
            int updated = submissionRepository.markFailedIfPending(submissionId, USER_MESSAGE, Instant.now(),
                    SubmissionStatus.FAILED, List.of(SubmissionStatus.QUEUED));
            if (updated == 0) {
                log.info("Dead-lettered report for submission {} ignored: already terminal or unknown", submissionId);
                return;
            }
            metrics.reportFailed();
            // The raw exception text stays in the log; the reporter gets a plain explanation.
            log.error("Submission {} FAILED after retries: {}", submissionId, reason);
            eventProducer.publishSubmissionProcessed(new SubmissionProcessedEvent(
                    EventMetadata.create(KafkaTopics.SUBMISSION_PROCESSED),
                    submissionId, reporterId, SubmissionStatus.FAILED, null, USER_MESSAGE));
        }
    }

    /**
     * Every other dead-letter topic: nothing can be repaired automatically, but each record is
     * logged with its failure reason and counted, so dead-lettering is visible in metrics.
     */
    @KafkaListener(topics = {
            KafkaTopics.HAZARD_VERIFIED + KafkaTopics.DLQ_SUFFIX,
            KafkaTopics.HAZARD_RESOLUTION_REQUESTED + KafkaTopics.DLQ_SUFFIX,
            KafkaTopics.HAZARD_RESOLVED + KafkaTopics.DLQ_SUFFIX,
            KafkaTopics.HAZARD_CREATED + KafkaTopics.DLQ_SUFFIX,
            KafkaTopics.HAZARD_UPDATED + KafkaTopics.DLQ_SUFFIX,
            KafkaTopics.SUBMISSION_PROCESSED + KafkaTopics.DLQ_SUFFIX},
            groupId = "dead-letter-monitor-group", containerFactory = "deadLetterListenerContainerFactory")
    public void onOtherDeadLetter(ConsumerRecord<String, Object> record,
                                  @Header(name = KafkaHeaders.DLT_EXCEPTION_MESSAGE, required = false) String reason) {
        metrics.deadLettered(record.topic());
        log.error("Dead-lettered record on {} (key={}, offset={}): {}", record.topic(), record.key(), record.offset(), reason);
    }
}
