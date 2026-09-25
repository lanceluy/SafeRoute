package com.saferoute.backend.support;

import com.saferoute.backend.push.PushMessage;
import com.saferoute.backend.push.PushSender;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.context.annotation.Primary;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Captures pushes instead of calling APNs. Imported by {@link IntegrationTestBase} for every
 * integration test, so they all keep sharing one Spring context: a second context (e.g. from
 * {@code @MockBean}) would join the same Kafka consumer groups and steal half the events.
 */
@TestComponent
@Primary
public class RecordingPushSender implements PushSender {

    /** Tokens starting with this are answered the way APNs answers an uninstalled app. */
    public static final String INVALID_TOKEN_PREFIX = "dead";

    public record Sent(String deviceToken, PushMessage message) {
    }

    private final List<Sent> sent = new CopyOnWriteArrayList<>();

    @Override
    public CompletableFuture<Result> send(String deviceToken, PushMessage message) {
        sent.add(new Sent(deviceToken, message));
        return CompletableFuture.completedFuture(
                deviceToken.startsWith(INVALID_TOKEN_PREFIX) ? Result.INVALID_TOKEN : Result.DELIVERED);
    }

    public List<PushMessage> sentTo(String deviceToken, UUID hazardId) {
        return sent.stream()
                .filter(s -> s.deviceToken().equals(deviceToken) && s.message().hazardId().equals(hazardId))
                .map(Sent::message)
                .toList();
    }
}
