package com.saferoute.backend.event.consumer;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.saferoute.backend.event.EventContext;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.ProcessedEventRepository;
import com.saferoute.backend.event.dto.HazardChange;
import com.saferoute.backend.event.dto.HazardUpdatedEvent;
import com.saferoute.backend.moderation.MunicipalDepartments;
import com.saferoute.backend.push.PushDevice;
import com.saferoute.backend.push.PushDeviceRepository;
import com.saferoute.backend.push.PushMessage;
import com.saferoute.backend.push.PushNotificationService;
import com.saferoute.backend.push.PushSender;
import com.saferoute.backend.user.NotificationPreferencesService;
import com.saferoute.backend.websocket.ReportUpdateFrame;
import com.saferoute.backend.websocket.WebSocketSessionRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;

import java.io.IOException;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Closes the loop for commuters: when a hazard they reported is assigned to a department,
 * resolved, removed or expires, each reporter (the original and anyone whose duplicate was merged
 * in) gets a report_update frame on their open sessions, or a push if they have none. Whoever
 * made the change isn't told about it, and users can turn these off in their preferences.
 *
 * <p>Delivery is at most once: the event is marked processed before sending, so a Kafka
 * redelivery never notifies twice. A missed note is recoverable (My Reports shows the state); a
 * duplicate is just noise.
 */
@Component
public class ReportFollowUpConsumer {

    private static final Logger log = LoggerFactory.getLogger(ReportFollowUpConsumer.class);
    static final String CONSUMER = "report-followup";
    private static final Set<HazardChange> FOLLOWED =
            EnumSet.of(HazardChange.RESOLVED, HazardChange.REMOVED, HazardChange.EXPIRED, HazardChange.MUNICIPAL_RESPONSE);

    private final JdbcTemplate jdbc;
    private final ProcessedEventRepository processedEvents;
    private final WebSocketSessionRegistry sessions;
    private final PushDeviceRepository devices;
    private final PushSender pushSender;
    private final NotificationPreferencesService preferences;
    private final MunicipalDepartments departments;
    private final ObjectMapper objectMapper;

    public ReportFollowUpConsumer(JdbcTemplate jdbc, ProcessedEventRepository processedEvents,
                                  WebSocketSessionRegistry sessions, PushDeviceRepository devices, PushSender pushSender,
                                  NotificationPreferencesService preferences, MunicipalDepartments departments,
                                  ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.processedEvents = processedEvents;
        this.sessions = sessions;
        this.devices = devices;
        this.pushSender = pushSender;
        this.preferences = preferences;
        this.departments = departments;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(topics = KafkaTopics.HAZARD_UPDATED, groupId = "report-followup-group")
    public void onHazardUpdated(HazardUpdatedEvent event) {
        if (!FOLLOWED.contains(event.change())) return;
        // Only a department being set is news to the reporter; a priority tweak isn't.
        if (event.change() == HazardChange.MUNICIPAL_RESPONSE && event.assignedDepartment() == null) return;
        try (var ignored = EventContext.enter(event.metadata())) {
            if (!processedEvents.markProcessed(event.metadata().eventId(), CONSUMER)) return;
            PushMessage message = message(event);
            var frame = new ReportUpdateFrame(event.hazardId(), event.type(), event.change(), event.status(),
                    event.assignedDepartment(), message.title(), message.body(), event.metadata().occurredAt());
            int told = 0;
            for (UUID reporter : reporters(event.hazardId())) {
                if (reporter.equals(event.actorUserId()) || !preferences.wantsReportUpdates(reporter)) continue;
                if (sendToSessions(reporter, frame)) {
                    told++;
                } else if (push(reporter, message)) {
                    told++;
                }
            }
            log.debug("Report update {} for hazard {} sent to {} reporter(s)", event.change(), event.hazardId(), told);
        }
    }

    /** The original reporter and everyone whose report was merged into this hazard. */
    List<UUID> reporters(UUID hazardId) {
        Set<UUID> ids = new LinkedHashSet<>(jdbc.queryForList(
                "SELECT reporter_id FROM hazards WHERE id = ?", UUID.class, hazardId));
        ids.addAll(jdbc.queryForList(
                "SELECT DISTINCT reporter_id FROM hazard_submissions WHERE canonical_hazard_id = ?", UUID.class, hazardId));
        return List.copyOf(ids);
    }

    PushMessage message(HazardUpdatedEvent event) {
        String what = PushNotificationService.label(event.type()).toLowerCase();
        return switch (event.change()) {
            case RESOLVED -> new PushMessage("Your report was resolved",
                    "The " + what + " you reported is marked fixed or gone. Thanks for reporting it.", event.hazardId(), "report_update");
            case REMOVED -> new PushMessage("Your report was removed",
                    "A moderator removed your " + what + " report as invalid.", event.hazardId(), "report_update");
            case EXPIRED -> new PushMessage("Your report expired",
                    "No one confirmed the " + what + " you reported recently, so it’s off the map. Report it again if it’s still there.",
                    event.hazardId(), "report_update");
            default -> new PushMessage("The city is on it",
                    "Makati City assigned your " + what + " report to " + departmentName(event.assignedDepartment()) + ".",
                    event.hazardId(), "report_update");
        };
    }

    private String departmentName(String code) {
        return departments.list().stream().filter(d -> d.code().equals(code)).map(MunicipalDepartments.Department::name)
                .findFirst().orElse(code);
    }

    /** @return true if at least one open session got the frame. */
    private boolean sendToSessions(UUID userId, ReportUpdateFrame frame) {
        boolean sent = false;
        for (WebSocketSessionRegistry.SessionInfo info : sessions.sessionsFor(userId)) {
            try {
                info.session().sendMessage(new TextMessage(objectMapper.writeValueAsString(frame)));
                sent = true;
            } catch (JsonProcessingException e) {
                log.error("Could not serialize report update", e);
                return false;
            } catch (IOException | IllegalStateException e) {
                log.warn("Failed to send report update to user {}: {}", userId, e.getMessage());
            }
        }
        return sent;
    }

    private boolean push(UUID userId, PushMessage message) {
        // Held back, not queued: My Reports still shows the new state when they next open the app.
        if (preferences.isQuietNow(userId)) return false;
        List<PushDevice> userDevices = devices.findByUserId(userId);
        for (PushDevice device : userDevices) {
            String token = device.getDeviceToken();
            pushSender.send(token, message).thenAccept(result -> {
                if (result == PushSender.Result.INVALID_TOKEN) devices.deleteById(token);
            });
        }
        return !userDevices.isEmpty();
    }
}
