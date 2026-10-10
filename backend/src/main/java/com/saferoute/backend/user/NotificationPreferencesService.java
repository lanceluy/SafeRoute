package com.saferoute.backend.user;

import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.websocket.AlertPreferences;
import com.saferoute.backend.websocket.WebSocketSessionRegistry;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

@Service
public class NotificationPreferencesService {

    /** {@code reportUpdates} and {@code quietHours} null on update mean "leave as is" (older app versions don't send them). */
    public record PreferencesDto(int radiusMeters, Set<HazardType> enabledTypes, Boolean reportUpdates, QuietHours quietHours) {
    }

    private final NotificationPreferencesRepository repository;
    private final WebSocketSessionRegistry registry;

    public NotificationPreferencesService(NotificationPreferencesRepository repository,
                                          @Lazy WebSocketSessionRegistry registry) {
        this.repository = repository;
        this.registry = registry;
    }

    public PreferencesDto get(UUID userId) {
        return toDto(load(userId));
    }

    /** Whether to tell this user what happened to hazards they reported. */
    public boolean wantsReportUpdates(UUID userId) {
        return load(userId).isReportUpdatesEnabled();
    }

    /** Whether background push alerts to this user are on hold right now. */
    public boolean isQuietNow(UUID userId) {
        return load(userId).quietHours().isQuietAt(Instant.now());
    }

    @Transactional
    public PreferencesDto update(UUID userId, PreferencesDto dto) {
        NotificationPreferences prefs = load(userId);
        prefs.setRadiusMeters(dto.radiusMeters());
        prefs.setEnabledTypes(dto.enabledTypes() != null ? dto.enabledTypes() : EnumSet.noneOf(HazardType.class));
        if (dto.reportUpdates() != null) prefs.setReportUpdatesEnabled(dto.reportUpdates());
        if (dto.quietHours() != null) prefs.setQuietHours(dto.quietHours());
        prefs.setUpdatedAt(Instant.now());
        repository.save(prefs);
        // Live sessions pick the change up immediately, without reconnecting.
        registry.updatePreferences(userId, toAlertPreferences(prefs));
        return toDto(prefs);
    }

    private static PreferencesDto toDto(NotificationPreferences prefs) {
        return new PreferencesDto(prefs.getRadiusMeters(), prefs.enabledTypes(), prefs.isReportUpdatesEnabled(), prefs.quietHours());
    }

    public AlertPreferences alertPreferences(UUID userId) {
        return toAlertPreferences(load(userId));
    }

    private NotificationPreferences load(UUID userId) {
        return repository.findById(userId).orElseGet(() -> NotificationPreferences.defaultsFor(userId));
    }

    private static AlertPreferences toAlertPreferences(NotificationPreferences prefs) {
        return new AlertPreferences(prefs.getRadiusMeters(), Set.copyOf(prefs.enabledTypes()), prefs.quietHours());
    }
}
