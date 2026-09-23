package com.saferoute.backend.admin;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.kafka.config.KafkaListenerEndpointRegistry;
import org.springframework.kafka.listener.MessageListenerContainer;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.TreeMap;

/**
 * Fault-tolerance experiment support (paper methodology; review §44): stop the Hazard Processing
 * consumer while reports keep arriving, then start it again and measure backlog recovery.
 * Because the processing module lives inside the same Spring Boot app as the API, stopping the
 * listener container is how "disable the consumer" is modelled without also killing the API.
 * Only registered when {@code saferoute.benchmark.consumer-control-enabled=true}.
 */
@RestController
@RequestMapping("/api/admin/consumers")
@ConditionalOnProperty(name = "saferoute.benchmark.consumer-control-enabled", havingValue = "true")
@PreAuthorize("hasAnyRole('MODERATOR','MUNICIPAL_OFFICIAL')")
@Tag(name = "Benchmark admin")
public class ConsumerControlController {

    private final KafkaListenerEndpointRegistry registry;

    public ConsumerControlController(KafkaListenerEndpointRegistry registry) {
        this.registry = registry;
    }

    @GetMapping
    @Operation(summary = "List listener containers and whether they are running")
    public Map<String, Boolean> list() {
        Map<String, Boolean> result = new TreeMap<>();
        for (MessageListenerContainer c : registry.getListenerContainers()) {
            result.put(c.getListenerId(), c.isRunning());
        }
        return result;
    }

    @PostMapping("/{id}/stop")
    public Map<String, Boolean> stop(@PathVariable String id) {
        container(id).stop();
        return list();
    }

    @PostMapping("/{id}/start")
    public Map<String, Boolean> start(@PathVariable String id) {
        container(id).start();
        return list();
    }

    private MessageListenerContainer container(String id) {
        MessageListenerContainer container = registry.getListenerContainer(id);
        if (container == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No listener " + id);
        return container;
    }
}
