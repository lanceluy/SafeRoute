package com.saferoute.backend.hazard.dto;

import com.saferoute.backend.submission.dto.HazardSubmissionResponse;

/**
 * @param hazard the canonical hazard (null while QUEUED or if FAILED)
 * @param mergedIntoExisting true when the report was added to someone else's hazard
 */
public record MyReportResponse(HazardSubmissionResponse submission, HazardResponse hazard, boolean mergedIntoExisting) {
}
