package com.saferoute.backend.event.producer;

import com.saferoute.backend.common.ApiException;
import org.springframework.http.HttpStatus;

public class EventPublishException extends ApiException {

    public EventPublishException(String topic, Throwable cause) {
        super(HttpStatus.SERVICE_UNAVAILABLE, "EVENT_BUS_UNAVAILABLE",
                "The event bus is temporarily unavailable. Please try again.");
        initCause(cause);
    }
}
