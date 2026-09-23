package com.saferoute.backend.ratelimit;

import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import io.github.bucket4j.EstimationProbe;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * In-memory token buckets (Bucket4j), keyed by policy + caller (user id or client IP).
 * Single-instance prototype: buckets are not shared across backend replicas.
 */
@Service
public class RateLimitService {

    private final RateLimitProperties properties;
    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    public RateLimitService(RateLimitProperties properties) {
        this.properties = properties;
    }

    /** Consumes one token or throws {@link RateLimitExceededException} (HTTP 429). */
    public void consume(RateLimitPolicy policy, String key) {
        if (!properties.isEnabled()) return;
        ConsumptionProbe probe = bucket(policy, key).tryConsumeAndReturnRemaining(1);
        if (!probe.isConsumed()) {
            throw exceeded(policy, probe.getNanosToWaitForRefill());
        }
    }

    /**
     * Throws if the bucket is already empty, without consuming. Used for login, where only
     * <em>failed</em> attempts should count against the caller.
     */
    public void checkNotExhausted(RateLimitPolicy policy, String key) {
        if (!properties.isEnabled()) return;
        EstimationProbe probe = bucket(policy, key).estimateAbilityToConsume(1);
        if (!probe.canBeConsumed()) {
            throw exceeded(policy, probe.getNanosToWaitForRefill());
        }
    }

    /** Records a failure (e.g. wrong password) without throwing. */
    public void recordFailure(RateLimitPolicy policy, String key) {
        if (!properties.isEnabled()) return;
        bucket(policy, key).tryConsume(1);
    }

    /** Test/benchmark hook. */
    public void reset() {
        buckets.clear();
    }

    private Bucket bucket(RateLimitPolicy policy, String key) {
        return buckets.computeIfAbsent(policy.name() + ":" + key, k -> {
            RateLimitProperties.Limit limit = properties.getLimits().get(policy);
            return Bucket.builder()
                    .addLimit(l -> l.capacity(limit.capacity()).refillGreedy(limit.capacity(), limit.period()))
                    .build();
        });
    }

    private RateLimitExceededException exceeded(RateLimitPolicy policy, long nanosToWait) {
        long seconds = Math.max(1, TimeUnit.NANOSECONDS.toSeconds(nanosToWait) + 1);
        RateLimitProperties.Limit limit = properties.getLimits().get(policy);
        String window = humanize(limit.period().toSeconds());
        String retry = humanize(seconds);
        return new RateLimitExceededException(
                "Too many " + policy.description() + " (limit " + limit.capacity() + " per " + window
                        + "). Try again in " + retry + ".", seconds);
    }

    private static String humanize(long seconds) {
        if (seconds >= 3600 && seconds % 3600 == 0) return plural(seconds / 3600, "hour");
        if (seconds >= 60) return plural((seconds + 59) / 60, "minute");
        return plural(seconds, "second");
    }

    private static String plural(long n, String unit) {
        return n + " " + unit + (n == 1 ? "" : "s");
    }
}
