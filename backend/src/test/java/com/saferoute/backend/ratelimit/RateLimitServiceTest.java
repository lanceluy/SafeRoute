package com.saferoute.backend.ratelimit;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RateLimitServiceTest {

    @Test
    void eleventhReportInAnHourIsRejectedWithRetryHint() {
        var service = new RateLimitService(new RateLimitProperties());
        for (int i = 0; i < 10; i++) service.consume(RateLimitPolicy.HAZARD_REPORT, "user-1");

        assertThatThrownBy(() -> service.consume(RateLimitPolicy.HAZARD_REPORT, "user-1"))
                .isInstanceOfSatisfying(RateLimitExceededException.class, e -> {
                    assertThat(e.getRetryAfterSeconds()).isBetween(1L, 3600L);
                    assertThat(e.getMessage()).contains("hazard reports").contains("10 per 1 hour");
                });
        // Buckets are per caller.
        service.consume(RateLimitPolicy.HAZARD_REPORT, "user-2");
    }

    @Test
    void loginOnlyCountsFailures() {
        var service = new RateLimitService(new RateLimitProperties());
        for (int i = 0; i < 5; i++) {
            service.checkNotExhausted(RateLimitPolicy.LOGIN_FAILURE, "1.2.3.4");
            service.recordFailure(RateLimitPolicy.LOGIN_FAILURE, "1.2.3.4");
        }
        assertThatThrownBy(() -> service.checkNotExhausted(RateLimitPolicy.LOGIN_FAILURE, "1.2.3.4"))
                .isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    void canBeDisabledForBenchmarks() {
        var props = new RateLimitProperties();
        props.setEnabled(false);
        props.setLimits(Map.of(RateLimitPolicy.REGISTER, new RateLimitProperties.Limit(1, Duration.ofHours(1))));
        var service = new RateLimitService(props);
        for (int i = 0; i < 50; i++) service.consume(RateLimitPolicy.REGISTER, "ip");
    }
}
