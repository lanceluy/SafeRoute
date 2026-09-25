package com.saferoute.backend.push;

import com.saferoute.backend.event.dto.HazardUpdatedEvent;
import com.saferoute.backend.spatial.GeoUtils;
import com.saferoute.backend.user.NotificationPreferencesService;
import com.saferoute.backend.websocket.AlertPreferences;
import com.saferoute.backend.websocket.WebSocketSessionRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Background alerts: an APNs push for an alert-worthy hazard near where a device last was, for
 * users who aren't currently connected over the WebSocket.
 *
 * <p>A user with a live session and a fresh location already got the in-app alert (the app keeps
 * its socket open in the background while navigating, which covers on-route alerts), so they are
 * skipped. The session registry is per instance, which is fine for the single-instance prototype.
 */
@Service
public class PushNotificationService {

    private static final Logger log = LoggerFactory.getLogger(PushNotificationService.class);
    /** The largest alert radius a user can pick (see MeController.PreferencesRequest). */
    private static final double MAX_RADIUS_METERS = 5000;
    private static final double METERS_PER_DEGREE_LAT = 111_320.0;

    private final PushDeviceRepository devices;
    private final PushSender sender;
    private final NotificationPreferencesService preferences;
    private final WebSocketSessionRegistry sessions;
    private final Duration locationMaxAge;

    public PushNotificationService(PushDeviceRepository devices, PushSender sender,
                                   NotificationPreferencesService preferences, WebSocketSessionRegistry sessions,
                                   @Value("${saferoute.push.location-max-age}") Duration locationMaxAge) {
        this.devices = devices;
        this.sender = sender;
        this.preferences = preferences;
        this.sessions = sessions;
        this.locationMaxAge = locationMaxAge;
    }

    /** Called by the Notification module for alert-worthy changes (new, verified, reinstated). */
    public void onHazardChanged(HazardUpdatedEvent event) {
        Instant now = Instant.now();
        double dLat = MAX_RADIUS_METERS / METERS_PER_DEGREE_LAT;
        double dLon = MAX_RADIUS_METERS / (METERS_PER_DEGREE_LAT * Math.cos(Math.toRadians(event.latitude())));
        List<PushDevice> candidates = devices.findWithFreshLocationIn(now.minus(locationMaxAge),
                event.latitude() - dLat, event.latitude() + dLat, event.longitude() - dLon, event.longitude() + dLon);

        Map<UUID, AlertPreferences> prefsByUser = new HashMap<>();
        int sent = 0;
        for (PushDevice device : candidates) {
            if (device.getUserId().equals(event.actorUserId())) continue; // they just reported / confirmed it
            double distance = GeoUtils.distanceMeters(device.getLatitude(), device.getLongitude(),
                    event.latitude(), event.longitude());
            AlertPreferences prefs = prefsByUser.computeIfAbsent(device.getUserId(), preferences::alertPreferences);
            if (distance > prefs.radiusMeters() || !prefs.enabledTypes().contains(event.type())) continue;
            if (hasLiveSession(device.getUserId(), now)) continue;

            String token = device.getDeviceToken();
            sender.send(token, message(event, distance)).thenAccept(result -> {
                if (result == PushSender.Result.INVALID_TOKEN) {
                    log.info("APNs reported device token {}… as invalid; removing it", token.substring(0, 8));
                    devices.deleteById(token);
                }
            });
            sent++;
        }
        log.debug("Push for hazard {}: {} candidate device(s), {} sent", event.hazardId(), candidates.size(), sent);
    }

    private boolean hasLiveSession(UUID userId, Instant now) {
        return sessions.sessionsFor(userId).stream().anyMatch(s -> s.hasFreshLocation(now));
    }

    static PushMessage message(HazardUpdatedEvent event, double distanceMeters) {
        String what = label(event.type());
        String title = switch (event.change()) {
            case VERIFIED -> "Verified hazard near you: " + what;
            case REINSTATED -> "Hazard reported again near you: " + what;
            default -> "Hazard near you: " + what;
        };
        long rounded = Math.max(10, Math.round(distanceMeters / 10.0) * 10);
        String body = "About " + rounded + " m from where you last were. " + label(event.severity()) + " severity.";
        return new PushMessage(title, body, event.hazardId());
    }

    /** OPEN_MANHOLE -> "Open manhole". */
    static String label(Enum<?> value) {
        if (value == null) return "Unknown";
        String words = value.name().replace('_', ' ').toLowerCase(Locale.ROOT);
        return Character.toUpperCase(words.charAt(0)) + words.substring(1);
    }
}
