package com.saferoute.backend.push;

import com.saferoute.backend.common.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Registers APNs device tokens and stores each device's latest background location.
 *
 * <p>Data minimisation: only the most recent point is kept, and it is cleared once it is older
 * than {@code saferoute.push.location-max-age}, after which it can no longer trigger an alert.
 */
@Service
public class PushDeviceService {

    private static final Logger log = LoggerFactory.getLogger(PushDeviceService.class);
    public static final Pattern TOKEN_PATTERN = Pattern.compile("^[0-9a-fA-F]{64,200}$");

    private final PushDeviceRepository repository;
    private final Duration locationMaxAge;

    public PushDeviceService(PushDeviceRepository repository,
                             @Value("${saferoute.push.location-max-age}") Duration locationMaxAge) {
        this.repository = repository;
        this.locationMaxAge = locationMaxAge;
    }

    /** Claims the token for this user. A device that changes account loses its previous owner's location. */
    @Transactional
    public void register(UUID userId, String deviceToken) {
        String token = normalize(deviceToken);
        Instant now = Instant.now();
        PushDevice device = repository.findById(token).orElse(null);
        if (device == null) {
            device = PushDevice.builder().deviceToken(token).userId(userId).createdAt(now).build();
        } else if (!device.getUserId().equals(userId)) {
            device.setUserId(userId);
            device.setLatitude(null);
            device.setLongitude(null);
            device.setLocationUpdatedAt(null);
        }
        device.setUpdatedAt(now);
        repository.save(device);
    }

    /** Idempotent: unregistering a token the caller doesn't own (or that is gone) does nothing. */
    @Transactional
    public void unregister(UUID userId, String deviceToken) {
        repository.findById(normalize(deviceToken))
                .filter(d -> d.getUserId().equals(userId))
                .ifPresent(repository::delete);
    }

    @Transactional
    public void updateLocation(UUID userId, String deviceToken, double latitude, double longitude) {
        PushDevice device = repository.findById(normalize(deviceToken))
                .filter(d -> d.getUserId().equals(userId))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "PUSH_DEVICE_NOT_FOUND",
                        "This device is not registered for push on your account"));
        Instant now = Instant.now();
        device.setLatitude(latitude);
        device.setLongitude(longitude);
        device.setLocationUpdatedAt(now);
        device.setUpdatedAt(now);
        repository.save(device);
    }

    @Scheduled(fixedDelayString = "PT10M", initialDelayString = "PT1M")
    @Transactional
    public void clearStaleLocations() {
        int cleared = repository.clearLocationsOlderThan(Instant.now().minus(locationMaxAge));
        if (cleared > 0) log.debug("Cleared {} stale push-device location(s)", cleared);
    }

    private static String normalize(String deviceToken) {
        if (deviceToken == null || !TOKEN_PATTERN.matcher(deviceToken).matches()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "deviceToken must be 64–200 hex characters");
        }
        return deviceToken.toLowerCase(Locale.ROOT);
    }
}
