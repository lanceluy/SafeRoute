package com.saferoute.backend.closure;

import com.saferoute.backend.auth.AuthenticatedUser;
import com.saferoute.backend.closure.dto.ClosureResponse;
import com.saferoute.backend.closure.dto.CreateClosureRequest;
import com.saferoute.backend.closure.dto.UpdateClosureRequest;
import com.saferoute.backend.common.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/closures")
@Tag(name = "Road closures")
public class RoadClosureController {

    static final String MODERATOR_ONLY = "hasAnyRole('MODERATOR','MUNICIPAL_OFFICIAL')";
    static final int MAX_REASON = 500;

    private final RoadClosureService service;

    public RoadClosureController(RoadClosureService service) {
        this.service = service;
    }

    @GetMapping("/active")
    @Operation(summary = "Every active road closure (newest first, at most 200)")
    public List<ClosureResponse> active() {
        return service.findActive();
    }

    @GetMapping("/in-bbox")
    @Operation(summary = "Active road closures touching the visible map region (at most 0.5° per side)")
    public List<ClosureResponse> inBbox(@RequestParam double minLat, @RequestParam double minLon,
                                        @RequestParam double maxLat, @RequestParam double maxLon) {
        return service.findInBbox(minLat, minLon, maxLat, maxLon);
    }

    @PostMapping
    @PreAuthorize(MODERATOR_ONLY)
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Block a road or path (moderator/official only)",
            description = "coordinates is the blocked line as [latitude, longitude] points. Clients show it live and "
                    + "route planning avoids it until it is lifted or reaches endsAt.")
    public ClosureResponse create(@Valid @RequestBody CreateClosureRequest request,
                                  @AuthenticationPrincipal AuthenticatedUser principal) {
        return service.create(principal.id(), request);
    }

    @PatchMapping("/{id}")
    @PreAuthorize(MODERATOR_ONLY)
    @Operation(summary = "Edit an active closure's name, reason or end time (moderator/official only)")
    public ClosureResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateClosureRequest request,
                                  @AuthenticationPrincipal AuthenticatedUser principal) {
        return service.update(id, principal.id(), request);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize(MODERATOR_ONLY)
    @Operation(summary = "Lift a closure (moderator/official only)",
            description = "The road is open again for routing. reason is recorded in the audit log.")
    public ClosureResponse lift(@PathVariable UUID id,
                                @RequestParam(required = false) String reason,
                                @AuthenticationPrincipal AuthenticatedUser principal) {
        if (reason != null && reason.length() > MAX_REASON) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
                    "reason must be at most " + MAX_REASON + " characters");
        }
        return service.lift(id, principal.id(), reason == null || reason.isBlank() ? null : reason.trim());
    }
}
