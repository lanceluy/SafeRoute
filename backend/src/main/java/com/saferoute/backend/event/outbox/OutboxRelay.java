package com.saferoute.backend.event.outbox;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Publishes committed {@code outbox_events} rows to Kafka, oldest first, and marks each one
 * published only after the broker acknowledges it.
 *
 * <ul>
 *   <li>Delivery is at-least-once: if an acknowledgement is lost the row is sent again with the
 *       same event id, and consumers skip it through {@code processed_events}.</li>
 *   <li>A single relay thread keeps rows for the same hazard in order. With several backend
 *       instances, {@code FOR UPDATE SKIP LOCKED} prevents double-sends but not reordering across
 *       instances; clients therefore apply hazard snapshots by version.</li>
 *   <li>If Kafka is down the batch stops at the first failure and the next sweep retries it, so
 *       an accepted report waits in the outbox instead of being marked FAILED.</li>
 * </ul>
 */
@Component
public class OutboxRelay implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);
    private static final int BATCH_SIZE = 100;
    private static final Duration RETAIN_PUBLISHED = Duration.ofDays(7);

    private record Row(long seq, String topic, String key, String type, String payload) {
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactionTemplate;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final ObjectMapper objectMapper;
    private final long sendTimeoutMs;
    private final Counter published;
    private final Counter publishFailures;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "outbox-relay");
        t.setDaemon(true);
        return t;
    });
    private final AtomicBoolean drainQueued = new AtomicBoolean();

    public OutboxRelay(JdbcTemplate jdbc,
                       TransactionTemplate transactionTemplate,
                       KafkaTemplate<String, Object> kafkaTemplate,
                       ObjectMapper objectMapper,
                       MeterRegistry registry,
                       @Value("${saferoute.outbox.send-timeout:PT10S}") Duration sendTimeout) {
        this.jdbc = jdbc;
        this.transactionTemplate = transactionTemplate;
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
        this.sendTimeoutMs = sendTimeout.toMillis();
        this.published = Counter.builder("saferoute.outbox.published")
                .description("Outbox messages acknowledged by Kafka").register(registry);
        this.publishFailures = Counter.builder("saferoute.outbox.publish.failures")
                .description("Failed publish attempts (the message is retried)").register(registry);
        Gauge.builder("saferoute.outbox.pending", this, OutboxRelay::pendingCount)
                .description("Committed messages not yet acknowledged by Kafka").register(registry);
        Gauge.builder("saferoute.outbox.oldest.pending.age.seconds", this, OutboxRelay::oldestPendingAgeSeconds)
                .description("Age of the oldest unpublished message").register(registry);
    }

    /** Coalesces wake-ups: at most one drain is queued behind the one running. */
    public void requestDrain() {
        if (drainQueued.compareAndSet(false, true)) {
            worker.execute(() -> {
                drainQueued.set(false);
                drain();
            });
        }
    }

    /** Safety net for wake-ups lost to a crash or a Kafka outage. */
    @Scheduled(fixedDelayString = "${saferoute.outbox.poll-interval:PT1S}", initialDelayString = "PT2S")
    public void sweep() {
        requestDrain();
    }

    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT5M")
    public void deleteOldPublished() {
        int deleted = jdbc.update("DELETE FROM outbox_events WHERE published_at < now() - make_interval(secs => ?)",
                RETAIN_PUBLISHED.toSeconds());
        if (deleted > 0) log.info("Deleted {} published outbox row(s) older than {}", deleted, RETAIN_PUBLISHED);
    }

    /** Publishes until the outbox is empty or a send fails. Visible for tests. */
    public void drain() {
        try {
            while (Boolean.TRUE.equals(transactionTemplate.execute(status -> publishBatch()))) {
                // keep going while full batches are being published
            }
        } catch (RuntimeException e) {
            log.warn("Outbox drain stopped: {}", e.getMessage());
        }
    }

    /** @return true if a full batch was published and more rows may be waiting. */
    private boolean publishBatch() {
        List<Row> rows = jdbc.query("""
                SELECT seq, topic, message_key, payload_type, payload::text FROM outbox_events
                WHERE published_at IS NULL AND failed_at IS NULL
                ORDER BY seq LIMIT ? FOR UPDATE SKIP LOCKED""",
                (rs, i) -> new Row(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5)),
                BATCH_SIZE);
        if (rows.isEmpty()) return false;

        // Send the whole batch, then await acknowledgements in order. The idempotent producer
        // preserves per-partition order, so stopping at the first failure never skips a message.
        List<Row> sent = new ArrayList<>();
        List<CompletableFuture<SendResult<String, Object>>> futures = new ArrayList<>();
        boolean sendFailed = false;
        for (Row row : rows) {
            Object event;
            try {
                event = objectMapper.readValue(row.payload(), Class.forName(row.type()));
            } catch (Exception e) {
                log.error("Outbox row {} can never be published ({}); parking it", row.seq(), e.getMessage());
                jdbc.update("UPDATE outbox_events SET failed_at = now(), attempts = attempts + 1, last_error = ? WHERE seq = ?",
                        truncate(e.toString()), row.seq());
                continue;
            }
            try {
                futures.add(kafkaTemplate.send(row.topic(), row.key(), event));
                sent.add(row);
            } catch (RuntimeException e) {
                recordFailure(row, e);
                sendFailed = true;
                break;
            }
        }
        for (int i = 0; i < sent.size(); i++) {
            Row row = sent.get(i);
            try {
                futures.get(i).get(sendTimeoutMs, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                recordFailure(row, e);
                return false;
            } catch (Exception e) {
                recordFailure(row, e);
                return false;
            }
            jdbc.update("UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE seq = ?", row.seq());
            published.increment();
        }
        return rows.size() == BATCH_SIZE && !sendFailed;
    }

    private void recordFailure(Row row, Exception e) {
        publishFailures.increment();
        log.warn("Publishing outbox row {} to {} failed; will retry: {}", row.seq(), row.topic(), e.getMessage());
        jdbc.update("UPDATE outbox_events SET attempts = attempts + 1, last_error = ? WHERE seq = ?",
                truncate(e.toString()), row.seq());
    }

    private double pendingCount() {
        try {
            Long n = jdbc.queryForObject(
                    "SELECT count(*) FROM outbox_events WHERE published_at IS NULL AND failed_at IS NULL", Long.class);
            return n != null ? n : 0;
        } catch (RuntimeException e) {
            return Double.NaN;
        }
    }

    private double oldestPendingAgeSeconds() {
        try {
            Double age = jdbc.queryForObject("""
                    SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0) FROM outbox_events
                    WHERE published_at IS NULL AND failed_at IS NULL""", Double.class);
            return age != null ? age : 0;
        } catch (RuntimeException e) {
            return Double.NaN;
        }
    }

    private static String truncate(String s) {
        return s.length() > 2000 ? s.substring(0, 2000) : s;
    }

    @Override
    public void destroy() {
        worker.shutdownNow();
    }
}
