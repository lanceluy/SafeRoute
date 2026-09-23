package com.saferoute.backend.event;

/** An event that can never succeed (invalid payload): skip retries and go straight to the DLQ. */
public class NonRetryableEventException extends RuntimeException {

    public NonRetryableEventException(String message) {
        super(message);
    }
}
