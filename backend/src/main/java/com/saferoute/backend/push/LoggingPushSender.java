package com.saferoute.backend.push;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.concurrent.CompletableFuture;

/** Default when APNs is not configured (no paid Apple Developer account): logs instead of sending. */
@Component
@ConditionalOnProperty(name = "saferoute.push.apns.enabled", havingValue = "false", matchIfMissing = true)
public class LoggingPushSender implements PushSender {

    private static final Logger log = LoggerFactory.getLogger(LoggingPushSender.class);

    @Override
    public CompletableFuture<Result> send(String deviceToken, PushMessage message) {
        log.debug("Push disabled; would send '{}' for hazard {} to device {}…", message.title(), message.hazardId(),
                deviceToken.substring(0, Math.min(8, deviceToken.length())));
        return CompletableFuture.completedFuture(Result.DISABLED);
    }
}
