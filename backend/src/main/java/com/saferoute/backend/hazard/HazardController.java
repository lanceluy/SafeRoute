package com.saferoute.backend.hazard;

import com.saferoute.backend.auth.AuthenticatedUser;
import com.saferoute.backend.hazard.dto.*;
import com.saferoute.backend.ratelimit.RateLimitPolicy;
import com.saferoute.backend.ratelimit.RateLimitService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/hazards")
@Tag(name = "Hazards")
public class HazardController {

    static final String MODERATOR_ONLY = "hasAnyRole('MODERATOR','MUNICIPAL_OFFICIAL')";
    public static final String TRUNCATED_HEADER = "X-Result-Truncated";

    private final HazardService hazardService;
    private final RateLimitService rateLimitService;

    public HazardController(HazardService hazardService, RateLimitService rateLimitService) {
        this.hazardService = hazardService;
        this.rateLimitService = rateLimitService;
    }

    @GetMapping("/nearby")
    @Operation(summary = "Hazards within a radius, nearest first",
            description = "radiusMeters 50–5000 (default 1000); limit 1–250 (default 100). statuses defaults to the "
                    + "active set REPORTED,VERIFIED,DISPUTED. types/statuses are comma-separated enum names.")
    public List<HazardResponse> nearby(@RequestParam double lat,
                                       @RequestParam double lon,
                                       @RequestParam(required = false) Double radiusMeters,
                                       @RequestParam(required = false) String types,
                                       @RequestParam(required = false) String statuses,
                                       @RequestParam(required = false) Integer limit) {
        return hazardService.findNearby(lat, lon, radiusMeters, types, statuses, limit);
    }

    @GetMapping("/in-bbox")
    @Operation(summary = "Hazards inside the visible map region",
            description = "Requires minLat < maxLat and minLon < maxLon, at most 0.5° per side; limit 1–250 (default 100). "
                    + "Most recently updated first. The response header X-Result-Truncated: true means more hazards "
                    + "matched than were returned, so the list must not be treated as a complete snapshot of the area.")
    public ResponseEntity<List<HazardResponse>> inBbox(@RequestParam double minLat,
                                                       @RequestParam double minLon,
                                                       @RequestParam double maxLat,
                                                       @RequestParam double maxLon,
                                                       @RequestParam(required = false) String types,
                                                       @RequestParam(required = false) String statuses,
                                                       @RequestParam(required = false) Integer limit) {
        HazardService.HazardPage page = hazardService.findInBbox(minLat, minLon, maxLat, maxLon, types, statuses, limit);
        return ResponseEntity.ok()
                .header(TRUNCATED_HEADER, Boolean.toString(page.truncated()))
                .body(page.hazards());
    }

    @PostMapping("/along-route")
    @Operation(summary = "Every active hazard along candidate routes",
            description = "For route assessment. Returns all active hazards within corridorMeters (default: the "
                    + "server's route corridor) of any route, not a recency-ordered sample. complete=false means the "
                    + "result was capped or a route leaves the pilot area; absence of hazards is then not evidence of safety.")
    public RouteHazardsResponse alongRoute(@Valid @RequestBody RouteHazardsRequest request) {
        return hazardService.findAlongRoutes(request);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Hazard detail: confidence, community counts, reporter trust tier and the caller's own opinion")
    public HazardDetailResponse getById(@PathVariable UUID id, @AuthenticationPrincipal AuthenticatedUser principal) {
        return hazardService.getDetail(id, principal);
    }

    @GetMapping("/{id}/history")
    @Operation(summary = "Timeline of the hazard: creation, confirmations, votes, status changes, edits, moderator actions")
    public List<HazardTimelineEntry> history(@PathVariable UUID id) {
        return hazardService.getTimeline(id);
    }

    @PutMapping("/{id}/confirmation")
    @Operation(summary = "Set your opinion (upsert): VERIFY or DISPUTE",
            description = "One opinion per user per hazard; sending the other action changes it. Asynchronous (202): "
                    + "the new counts/status arrive as a hazard_* WebSocket frame. 60 per hour per user.")
    @ApiResponse(responseCode = "202", description = "Queued")
    @ApiResponse(responseCode = "409", description = "SELF_CONFIRMATION_NOT_ALLOWED or HAZARD_NOT_ACTIVE")
    public ResponseEntity<CommandAccepted> setConfirmation(@PathVariable UUID id,
                                                           @Valid @RequestBody ConfirmationRequest request,
                                                           @AuthenticationPrincipal AuthenticatedUser principal) {
        rateLimitService.consume(RateLimitPolicy.CONFIRMATION, principal.id().toString());
        return ResponseEntity.accepted().body(hazardService.setConfirmation(id, principal.id(), request.action()));
    }

    @PostMapping("/{id}/resolution-confirmation")
    @Operation(summary = "Vote NO_LONGER_PRESENT or STILL_PRESENT",
            description = "Normal users can't resolve directly. After enough independent NO_LONGER_PRESENT votes "
                    + "(outnumbering STILL_PRESENT) the hazard becomes RESOLVED. STILL_PRESENT extends its expiry. 20 per hour per user.")
    public ResponseEntity<CommandAccepted> resolutionVote(@PathVariable UUID id,
                                                          @Valid @RequestBody ResolutionVoteRequest request,
                                                          @AuthenticationPrincipal AuthenticatedUser principal) {
        rateLimitService.consume(RateLimitPolicy.RESOLUTION, principal.id().toString());
        return ResponseEntity.accepted().body(hazardService.requestResolution(id, principal.id(), request.action()));
    }

    @PatchMapping("/{id}")
    @Operation(summary = "Edit a hazard (reporter or moderator)",
            description = "Reporters: description/photo any time while active; type, severity and location (≤50 m) only "
                    + "while still REPORTED. Moderators: everything. Every change is audited.")
    public HazardResponse update(@PathVariable UUID id,
                                 @Valid @RequestBody UpdateHazardRequest request,
                                 @AuthenticationPrincipal AuthenticatedUser principal) {
        return hazardService.update(id, principal, request);
    }

    @PostMapping("/{id}/resolve")
    @PreAuthorize(MODERATOR_ONLY)
    @Operation(summary = "Resolve immediately (moderator/official only)")
    @ApiResponse(responseCode = "403", description = "Caller is not a moderator/official")
    public ResponseEntity<CommandAccepted> resolve(@PathVariable UUID id,
                                                   @Valid @RequestBody(required = false) ResolveRequest request,
                                                   @AuthenticationPrincipal AuthenticatedUser principal) {
        return ResponseEntity.accepted().body(hazardService.resolve(id, principal.id(), request != null ? request.note() : null));
    }

    @PostMapping("/{id}/reopen")
    @PreAuthorize(MODERATOR_ONLY)
    @Operation(summary = "Reopen a resolved/expired/removed hazard (moderator/official only)")
    public HazardResponse reopen(@PathVariable UUID id,
                                 @Valid @RequestBody(required = false) ResolveRequest request,
                                 @AuthenticationPrincipal AuthenticatedUser principal) {
        return hazardService.reopen(id, principal.id(), request != null ? request.note() : null);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize(MODERATOR_ONLY)
    @Operation(summary = "Remove a false/spam report (moderator/official only)",
            description = "Soft delete: status becomes REMOVED; reporter reputation is penalised.")
    @ResponseStatus(HttpStatus.OK)
    public HazardResponse remove(@PathVariable UUID id,
                                 @Parameter(description = "Reason, recorded in the audit log") @RequestParam(required = false) String reason,
                                 @AuthenticationPrincipal AuthenticatedUser principal) {
        return hazardService.remove(id, principal.id(), reason);
    }
}
