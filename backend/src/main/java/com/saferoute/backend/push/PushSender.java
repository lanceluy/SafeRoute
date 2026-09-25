package com.saferoute.backend.push;

import java.util.concurrent.CompletableFuture;

/** Delivers alerts to a device. {@link ApnsPushSender} when APNs is configured, {@link LoggingPushSender} otherwise. */
public interface PushSender {

    enum Result {
        DELIVERED,
        /** The token will never work again (app uninstalled, wrong environment); forget it. */
        INVALID_TOKEN,
        FAILED,
        /** Push is switched off; nothing was sent. */
        DISABLED
    }

    CompletableFuture<Result> send(String deviceToken, PushMessage message);
}
