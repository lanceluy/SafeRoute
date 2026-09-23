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
            metrics.reportFailed();
            submissionRepository.findById(event.submissionId()).ifPresent(submission -> {
                if (submission.getProcessingStatus().isTerminal()) return;
                submission.setProcessingStatus(SubmissionStatus.FAILED);
                // The raw exception text stays in the log; the reporter gets a plain explanation.
                submission.setFailureReason(USER_MESSAGE);
                submission.setProcessedAt(Instant.now());
                log.error("Submission {} FAILED after retries: {}", submission.getId(), reason);
                eventProducer.publishSubmissionProcessed(new SubmissionProcessedEvent(
                        EventMetadata.create(KafkaTopics.SUBMISSION_PROCESSED),
                        submission.getId(), submission.getReporterId(), SubmissionStatus.FAILED, null,
                        USER_MESSAGE));
            });
        }
    }
}
