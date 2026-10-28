package com.saferoute.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.UUID;

/**
 * Consumer group for the notification listeners. A single instance uses a fixed group (offsets
 * survive restarts). Running several instances needs a group per instance, because each one only
 * knows its own WebSocket sessions; enable that with SAFEROUTE_NOTIFICATION_PER_INSTANCE_GROUP=true.
 * Abandoned per-instance groups are expired by the broker's offsets.retention.minutes.
 */
@Configuration
public class NotificationGroupConfig {

    @Bean("notificationGroupId")
    public String notificationGroupId(@Value("${saferoute.notification.group-id}") String base,
                                      @Value("${saferoute.notification.per-instance-group}") boolean perInstance) {
        return perInstance ? base + "-" + UUID.randomUUID().toString().substring(0, 8) : base;
    }
}
