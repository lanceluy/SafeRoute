package com.saferoute.backend.submission;

import com.saferoute.backend.auth.AuthenticatedUser;
import com.saferoute.backend.ratelimit.RateLimitPolicy;
import com.saferoute.backend.ratelimit.RateLimitService;
import com.saferoute.backend.submission.dto.HazardSubmissionRequest;
import com.saferoute.backend.submission.dto.HazardSubmissionResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/hazard-submissions")
@Tag(name = "Hazard submissions", description = "Asynchronous hazard reporting")
public class HazardSubmissionController {

    private final HazardSubmissionService submissionService;
    private final RateLimitService rateLimitService;

    public HazardSubmissionController(HazardSubmissionService submissionService, RateLimitService rateLimitService) {
        this.submissionService = submissionService;
        this.rateLimitService = rateLimitService;
    }

    @PostMapping
    @Operation(summary = "Report a hazard",
            description = """
                    Returns 202 immediately with a submissionId and status QUEUED. The Hazard Processing \
                    consumer then either CREATES a new hazard or MERGES the report into an existing one \
                    (same type, within the duplicate radius and lookback window). The outcome arrives as a \
                    `submission_processed` WebSocket frame, or poll GET /api/hazard-submissions/{id}. \
                    Limited to 10 reports per hour per user.""")
    @ApiResponse(responseCode = "202", description = "Queued for processing")
    @ApiResponse(responseCode = "422", description = "OUTSIDE_COVERAGE_AREA")
    @ApiResponse(responseCode = "429", description = "RATE_LIMITED")
    @ApiResponse(responseCode = "503", description = "EVENT_BUS_UNAVAILABLE")
    public ResponseEntity<HazardSubmissionResponse> submit(@Valid @RequestBody HazardSubmissionRequest request,
                                                           @AuthenticationPrincipal AuthenticatedUser principal) {
        rateLimitService.consume(RateLimitPolicy.HAZARD_REPORT, principal.id().toString());
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(submissionService.submit(request, principal.id()));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Poll a submission's processing status (owner only)")
    public HazardSubmissionResponse get(@PathVariable UUID id, @AuthenticationPrincipal AuthenticatedUser principal) {
        return submissionService.get(id, principal.id(), principal.canModerate());
    }
}
