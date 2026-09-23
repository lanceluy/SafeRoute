package com.saferoute.backend.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;

@ConfigurationProperties(prefix = "saferoute.rate-limit")
public class RateLimitProperties {

    public record Limit(int capacity, Duration period) {
    }

    /** Disabled only for synthetic load benchmarks, where hundreds of simulated users share one IP. */
    private boolean enabled = true;

    private Map<RateLimitPolicy, Limit> limits = new EnumMap<>(Map.of(
            RateLimitPolicy.LOGIN_FAILURE, new Limit(5, Duration.ofMinutes(10)),
            RateLimitPolicy.REGISTER, new Limit(3, Duration.ofHours(1)),
            RateLimitPolicy.HAZARD_REPORT, new Limit(10, Duration.ofHours(1)),
            RateLimitPolicy.CONFIRMATION, new Limit(60, Duration.ofHours(1)),
            RateLimitPolicy.RESOLUTION, new Limit(20, Duration.ofHours(1)),
            RateLimitPolicy.IMAGE_UPLOAD, new Limit(10, Duration.ofHours(1))
    ));

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public Map<RateLimitPolicy, Limit> getLimits() {
        return limits;
    }

    public void setLimits(Map<RateLimitPolicy, Limit> limits) {
        // Merge so a partial override in application.yml keeps the other defaults.
        this.limits.putAll(limits);
    }
}
