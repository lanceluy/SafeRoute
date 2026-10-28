package com.saferoute.backend.delivery;

import com.saferoute.backend.spatial.GeoUtils;
import com.saferoute.backend.websocket.HazardEventFrame;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * In-process fan-out for the non-WebSocket delivery channels (long polling and Server-Sent
 * Events). {@code NotificationConsumer} publishes every hazard change here next to the WebSocket
 * fan-out, so all channels are fed by the same Kafka event and can be compared like for like.
 *
 * <p>Changes get a per-instance, monotonically increasing sequence number and a bounded replay
 * buffer, so a client that reconnects (long poll {@code since}, SSE {@code Last-Event-ID}) can
 * catch up without losing events. Sequence numbers are only meaningful on the instance that issued
 * them; the cursor carries {@link #instanceId()} and a mismatch tells the client to resync.
 */
@Component
public class HazardChangeBroker {

    static final int REPLAY_CAPACITY = 2000;

    public record Change(long seq, HazardEventFrame frame) {
    }

    /** A listener interested in changes within {@code radiusMeters} of a point. */
    public record Subscriber(double lat, double lon, double radiusMeters, Consumer<Change> sink) {
        boolean wants(HazardEventFrame f) {
            return GeoUtils.distanceMeters(lat, lon, f.latitude(), f.longitude()) <= radiusMeters;
        }
    }

    private final String instanceId = UUID.randomUUID().toString().substring(0, 8);
    private final ArrayDeque<Change> replay = new ArrayDeque<>();
    private final List<Subscriber> subscribers = new CopyOnWriteArrayList<>();
    private long seq = 0;

    public String instanceId() {
        return instanceId;
    }

    public void publish(HazardEventFrame frame) {
        Change change;
        synchronized (this) {
            change = new Change(++seq, frame);
            replay.addLast(change);
            if (replay.size() > REPLAY_CAPACITY) replay.removeFirst();
        }
        for (Subscriber s : subscribers) {
            if (s.wants(frame)) s.sink().accept(change);
        }
    }

    public synchronized long latestSeq() {
        return seq;
    }

    /** Buffered changes after {@code afterSeq} within the subscriber's radius, oldest first. */
    public synchronized List<Change> since(long afterSeq, double lat, double lon, double radiusMeters) {
        Subscriber probe = new Subscriber(lat, lon, radiusMeters, c -> { });
        List<Change> out = new ArrayList<>();
        for (Change c : replay) if (c.seq() > afterSeq && probe.wants(c.frame())) out.add(c);
        return out;
    }

    /** True if {@code afterSeq} has already been evicted, so the client may have missed changes. */
    public synchronized boolean gapBefore(long afterSeq) {
        return !replay.isEmpty() && afterSeq < replay.peekFirst().seq() - 1;
    }

    public void subscribe(Subscriber s) {
        subscribers.add(s);
    }

    public void unsubscribe(Subscriber s) {
        subscribers.remove(s);
    }

    public int subscriberCount() {
        return subscribers.size();
    }
}
