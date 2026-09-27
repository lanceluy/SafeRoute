package com.saferoute.backend.moderation;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.common.PageResponse;
import com.saferoute.backend.hazard.dto.HazardResponse;
import com.saferoute.backend.moderation.dto.ActivityEntry;
import com.saferoute.backend.moderation.dto.ModerationStats;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.UUID;

@RestController
@RequestMapping("/api/moderation")
@PreAuthorize("hasAnyRole('MODERATOR','MUNICIPAL_OFFICIAL')")
@Tag(name = "Moderation", description = "Moderator/official tools. Resolve/reopen/remove live under /api/hazards/{id}.")
public class ModerationController {

    private final ModerationQueryService queries;

    public ModerationController(ModerationQueryService queries) {
        this.queries = queries;
    }

    @GetMapping("/hazards")
    @Operation(summary = "Review queue, filtered and sorted",
            description = "Default order: DISPUTED first, then reports from the lowest-reputation reporters. "
                    + "`view` picks a queue tab and replaces `statuses`; every other filter narrows it further.")
    public PageResponse<HazardResponse> queue(
            @Parameter(description = "attention, high, contested, expiring, unconfirmed, active or removed")
            @RequestParam(required = false) String view,
            @Parameter(description = "Comma-separated statuses (default: active ones). Ignored with `view`.")
            @RequestParam(required = false) String statuses,
            @RequestParam(required = false) String types,
            @RequestParam(required = false) String severities,
            @Parameter(description = "Comma-separated: UNCONFIRMED, LOW, MEDIUM, HIGH, CONTESTED")
            @RequestParam(required = false) String confidences,
            @Parameter(description = "Reported at or after (ISO-8601 instant)") @RequestParam(required = false) String from,
            @Parameter(description = "Reported before (ISO-8601 instant)") @RequestParam(required = false) String to,
            @Parameter(description = "minLat,minLon,maxLat,maxLon") @RequestParam(required = false) String bbox,
            @Parameter(description = "Matches the description or the hazard type") @RequestParam(required = false) String q,
            @Parameter(description = "review (default), newest, oldest, severity, confidence, disputed, confirmed, expiring")
            @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        requirePage(page, size);
        var filter = new ModerationQueryService.QueueFilter(
                parseEnum(view, ModerationQueryService.View.class, "view"), statuses, types, severities, confidences,
                parseInstant(from, "from"), parseInstant(to, "to"), parseBbox(bbox), q,
                parseEnum(sort, ModerationQueryService.Sort.class, "sort"));
        return queries.queue(filter, page, size);
    }

    @GetMapping("/stats")
    @Operation(summary = "Dashboard numbers: active totals, queue sizes, daily trend and resolution time",
            description = "Defaults to the last 7 days. Days are counted in `tz` (default Asia/Manila).")
    public ModerationStats stats(@RequestParam(required = false) String from,
                                 @RequestParam(required = false) String to,
                                 @RequestParam(defaultValue = "Asia/Manila") String tz) {
        return queries.stats(parseInstant(from, "from"), parseInstant(to, "to"), tz);
    }

    @GetMapping("/activity")
    @Operation(summary = "Audit feed across all hazards, newest first",
            description = "Staff actors are named; commuters appear only as REPORTER or COMMUNITY.")
    public PageResponse<ActivityEntry> activity(@RequestParam(required = false) UUID hazardId,
                                                @Parameter(description = "Comma-separated audit actions, e.g. MODERATOR_RESOLVED,STATUS_CHANGED")
                                                @RequestParam(required = false) String actions,
                                                @Parameter(description = "Only moderator/official actions")
                                                @RequestParam(defaultValue = "false") boolean staffOnly,
                                                @RequestParam(defaultValue = "0") int page,
                                                @RequestParam(defaultValue = "50") int size) {
        requirePage(page, size);
        return queries.activity(hazardId, actions, staffOnly, page, size);
    }

    private static void requirePage(int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw badRequest("page must be >= 0 and size between 1 and 100");
        }
    }

    private static <E extends Enum<E>> E parseEnum(String value, Class<E> type, String param) {
        if (value == null || value.isBlank()) return null;
        try {
            return Enum.valueOf(type, value.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw badRequest("Unknown " + param + "; allowed: " + Arrays.toString(type.getEnumConstants()).toLowerCase());
        }
    }

    private static Instant parseInstant(String value, String param) {
        if (value == null || value.isBlank()) return null;
        try {
            return Instant.parse(value.trim());
        } catch (DateTimeParseException e) {
            throw badRequest(param + " must be an ISO-8601 instant, e.g. 2026-09-01T00:00:00Z");
        }
    }

    private static double[] parseBbox(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return Arrays.stream(value.split(",")).mapToDouble(s -> Double.parseDouble(s.trim())).toArray();
        } catch (NumberFormatException e) {
            throw badRequest("bbox must be minLat,minLon,maxLat,maxLon");
        }
    }

    private static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
    }
}
