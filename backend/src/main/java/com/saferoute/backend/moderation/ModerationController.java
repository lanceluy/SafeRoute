package com.saferoute.backend.moderation;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.common.PageResponse;
import com.saferoute.backend.hazard.HazardService;
import com.saferoute.backend.hazard.dto.HazardResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/moderation")
@PreAuthorize("hasAnyRole('MODERATOR','MUNICIPAL_OFFICIAL')")
@Tag(name = "Moderation", description = "Moderator/official tools. Resolve/reopen/remove live under /api/hazards/{id}.")
public class ModerationController {

    private final HazardService hazardService;

    public ModerationController(HazardService hazardService) {
        this.hazardService = hazardService;
    }

    @GetMapping("/hazards")
    @Operation(summary = "Review queue: DISPUTED first, then reports from the lowest-reputation reporters")
    public PageResponse<HazardResponse> queue(@RequestParam(required = false) String statuses,
                                              @RequestParam(defaultValue = "0") int page,
                                              @RequestParam(defaultValue = "50") int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "page must be >= 0 and size between 1 and 100");
        }
        return hazardService.moderationQueue(statuses, page, size);
    }
}
