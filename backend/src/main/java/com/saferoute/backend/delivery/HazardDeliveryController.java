package com.saferoute.backend.delivery;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.async.DeferredResult;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.springframework.http.HttpStatus.BAD_REQUEST;

/**
 * Alternative push-style channels to the WebSocket, over plain HTTP: long polling and
 * Server-Sent Events. They exist so the paper can compare delivery mechanisms on the same
 * event pipeline; the WebSocket stays the primary channel (it also carries the client's route and
 * alert preferences, which these map-update channels do not).
 */
@RestController
@RequestMapping("/api/hazards")
@Tag(name = "Hazard delivery (alternatives)")
public class HazardDeliveryController {

    static final double DEFAULT_RADIUS_METERS = 5000;
    static final Duration MAX_HOLD = Duration.ofSeconds(60);
    static final Duration SSE_TIMEOUT = Duration.ofMinutes(30);

    public record PollResponse(String cursor, boolean resync, List<HazardChangeBroker.Change> changes) {
    }

    private final HazardChangeBroker broker;

    public HazardDeliveryController(HazardChangeBroker broker) {
        this.broker = broker;
    }

    @GetMapping("/poll")
    @Operation(summary = "Long poll for hazard changes near a point",
            description = "Without `since`, returns the current cursor immediately. With `since` (a cursor from a "
                    + "previous response), returns as soon as a change within radiusMeters occurs, or an empty "
                    + "list after holdSeconds (default 25, max 60). resync=true means the cursor is from another "
                    + "instance or fell out of the replay buffer: refetch the area, then continue from `cursor`.")
    public DeferredResult<ResponseEntity<PollResponse>> poll(@RequestParam double lat, @RequestParam double lon,
                                                             @RequestParam(required = false) Double radiusMeters,
                                                             @RequestParam(required = false) String since,
                                                             @RequestParam(required = false) Integer holdSeconds) {
        double radius = radiusMeters != null ? radiusMeters : DEFAULT_RADIUS_METERS;
        long hold = Math.min(holdSeconds != null ? holdSeconds : 25, MAX_HOLD.toSeconds());
        var result = new DeferredResult<ResponseEntity<PollResponse>>(hold * 1000);

        long after;
        if (since == null) {
            result.setResult(ResponseEntity.ok(new PollResponse(cursor(broker.latestSeq()), false, List.of())));
            return result;
        }
        try {
            String[] parts = since.split(":");
            if (parts.length != 2) throw new NumberFormatException();
            after = Long.parseLong(parts[1]);
            if (!parts[0].equals(broker.instanceId()) || broker.gapBefore(after)) {
                result.setResult(ResponseEntity.ok(new PollResponse(cursor(broker.latestSeq()), true, List.of())));
                return result;
            }
        } catch (NumberFormatException e) {
            throw new org.springframework.web.server.ResponseStatusException(BAD_REQUEST, "Malformed cursor");
        }

        AtomicBoolean done = new AtomicBoolean();
        HazardChangeBroker.Subscriber[] holder = new HazardChangeBroker.Subscriber[1];
        holder[0] = new HazardChangeBroker.Subscriber(lat, lon, radius, change -> {
            if (done.compareAndSet(false, true)) {
                broker.unsubscribe(holder[0]);
                respondWithChangesSince(result, after, lat, lon, radius);
            }
        });
        // Subscribe first, then re-check the buffer, so a change between the two is not lost.
        broker.subscribe(holder[0]);
        Runnable cleanup = () -> broker.unsubscribe(holder[0]);
        result.onCompletion(cleanup);
        result.onTimeout(() -> {
            cleanup.run();
            if (done.compareAndSet(false, true)) {
                result.setResult(ResponseEntity.ok(new PollResponse(since, false, List.of())));
            }
        });
        if (!broker.since(after, lat, lon, radius).isEmpty() && done.compareAndSet(false, true)) {
            cleanup.run();
            respondWithChangesSince(result, after, lat, lon, radius);
        }
        return result;
    }

    @GetMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "Server-Sent Events stream of hazard changes near a point",
            description = "One event per change (event name = frame type, id = per-instance sequence). Reconnecting "
                    + "clients send Last-Event-ID to replay what they missed from the in-memory buffer.")
    public SseEmitter stream(@RequestParam double lat, @RequestParam double lon,
                             @RequestParam(required = false) Double radiusMeters,
                             @RequestHeader(value = "Last-Event-ID", required = false) String lastEventId) {
        double radius = radiusMeters != null ? radiusMeters : DEFAULT_RADIUS_METERS;
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT.toMillis());
        HazardChangeBroker.Subscriber[] holder = new HazardChangeBroker.Subscriber[1];
        holder[0] = new HazardChangeBroker.Subscriber(lat, lon, radius, change -> {
            try {
                emitter.send(SseEmitter.event().id(String.valueOf(change.seq())).name(change.frame().type()).data(change.frame()));
            } catch (IOException | IllegalStateException e) {
                broker.unsubscribe(holder[0]);
            }
        });
        broker.subscribe(holder[0]);
        emitter.onCompletion(() -> broker.unsubscribe(holder[0]));
        emitter.onTimeout(() -> { broker.unsubscribe(holder[0]); emitter.complete(); });
        emitter.onError(e -> broker.unsubscribe(holder[0]));
        try {
            // An initial comment flushes headers so clients know the stream is live.
            emitter.send(SseEmitter.event().comment("connected"));
            if (lastEventId != null) {
                for (HazardChangeBroker.Change c : broker.since(Long.parseLong(lastEventId), lat, lon, radius)) {
                    emitter.send(SseEmitter.event().id(String.valueOf(c.seq())).name(c.frame().type()).data(c.frame()));
                }
            }
        } catch (IOException | NumberFormatException e) {
            broker.unsubscribe(holder[0]);
            emitter.complete();
        }
        return emitter;
    }

    /** The head is read before the changes, so a concurrent change can only be redelivered, never lost. */
    private void respondWithChangesSince(DeferredResult<ResponseEntity<PollResponse>> result, long after,
                                         double lat, double lon, double radius) {
        long head = broker.latestSeq();
        result.setResult(ResponseEntity.ok(new PollResponse(cursor(head), false, broker.since(after, lat, lon, radius))));
    }

    private String cursor(long seq) {
        return broker.instanceId() + ":" + seq;
    }
}
