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

    public record PreferencesDto(int radiusMeters, Set<HazardType> enabledTypes) {
    }

    private final NotificationPreferencesRepository repository;
    private final WebSocketSessionRegistry registry;

    public NotificationPreferencesService(NotificationPreferencesRepository repository,
                                          @Lazy WebSocketSessionRegistry registry) {
        this.repository = repository;
        this.registry = registry;
    }

    public PreferencesDto get(UUID userId) {
        NotificationPreferences prefs = load(userId);
        return new PreferencesDto(prefs.getRadiusMeters(), prefs.enabledTypes());
    }

    @Transactional
    public PreferencesDto update(UUID userId, PreferencesDto dto) {
        NotificationPreferences prefs = load(userId);
        prefs.setRadiusMeters(dto.radiusMeters());
        prefs.setEnabledTypes(dto.enabledTypes() != null ? dto.enabledTypes() : EnumSet.noneOf(HazardType.class));
        prefs.setUpdatedAt(Instant.now());
        repository.save(prefs);
        // Live sessions pick the change up immediately, without reconnecting.
        registry.updatePreferences(userId, toAlertPreferences(prefs));
        return new PreferencesDto(prefs.getRadiusMeters(), prefs.enabledTypes());
    }

    public AlertPreferences alertPreferences(UUID userId) {
        return toAlertPreferences(load(userId));
    }

    private NotificationPreferences load(UUID userId) {
        return repository.findById(userId).orElseGet(() -> NotificationPreferences.defaultsFor(userId));
    }

    private static AlertPreferences toAlertPreferences(NotificationPreferences prefs) {
        return new AlertPreferences(prefs.getRadiusMeters(), Set.copyOf(prefs.enabledTypes()));
    }
}
