package com.saferoute.backend.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

/**
 * The research metrics (review §32, §45). Timers publish p50/p95/p99 so the benchmark can read
 * them from /actuator/prometheus without post-processing raw samples.
 */
@Component
public class SafeRouteMetrics {

    private final Counter reportsAccepted;
    private final Counter reportsCreated;
    private final Counter reportsMerged;
    private final Counter reportsFailed;
    private final Counter dedupMatches;
    private final Counter consumerErrors;
    private final Timer processingLatency;
    private final Timer notificationLatency;
    private final MeterRegistry registry;

    public SafeRouteMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.reportsAccepted = Counter.builder("saferoute.hazard.report.accepted")
                .description("Hazard submissions accepted by the API (202)").register(registry);
        this.reportsCreated = Counter.builder("saferoute.hazard.report.processed")
                .tag("outcome", "created").description("Submissions that created a new hazard").register(registry);
        this.reportsMerged = Counter.builder("saferoute.hazard.report.processed")
                .tag("outcome", "merged").description("Submissions merged into an existing hazard").register(registry);
        this.reportsFailed = Counter.builder("saferoute.hazard.report.failed")
                .description("Submissions that ended in the dead-letter topic").register(registry);
        this.dedupMatches = Counter.builder("saferoute.dedup.matches")
                .description("Duplicate reports detected by the spatial dedup check").register(registry);
        this.consumerErrors = Counter.builder("saferoute.kafka.consumer.errors")
                .description("Failed Kafka deliveries (each retry attempt counts)").register(registry);
        this.processingLatency = latencyTimer("saferoute.hazard.processing.latency",
                "Event produced (API accepted) -> hazard persisted/merged");
        this.notificationLatency = latencyTimer("saferoute.notification.delivery.latency",
                "Canonical hazard state committed -> WebSocket frame written");
    }

    private Timer latencyTimer(String name, String description) {
        return Timer.builder(name)
                .description(description)
                .publishPercentiles(0.5, 0.95, 0.99)
                .publishPercentileHistogram()
                .minimumExpectedValue(Duration.ofMillis(1))
                .maximumExpectedValue(Duration.ofSeconds(60))
                .register(registry);
    }

    public void reportAccepted() { reportsAccepted.increment(); }
    public void reportCreated() { reportsCreated.increment(); }
    public void reportMerged() { reportsMerged.increment(); dedupMatches.increment(); }
    public void reportFailed() { reportsFailed.increment(); }
    public void consumerError() { consumerErrors.increment(); }

    public void recordProcessingLatency(Instant producedAt) {
        processingLatency.record(Duration.between(producedAt, Instant.now()));
    }

    public void recordNotificationLatency(Instant stateCommittedAt) {
        notificationLatency.record(Duration.between(stateCommittedAt, Instant.now()));
    }

    public MeterRegistry registry() {
        return registry;
    }
}
