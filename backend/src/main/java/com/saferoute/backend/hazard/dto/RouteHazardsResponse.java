package com.saferoute.backend.hazard.dto;

import java.util.List;

/**
 * @param hazards            every active hazard within the corridor (up to the server cap)
 * @param complete           true only if nothing was cut off and every point is inside the pilot
 *                           area; clients must not present an incomplete assessment as "no hazards"
 * @param truncated          more hazards matched than were returned
 * @param leavesCoverageArea part of a route is outside the area where hazards are collected
 */
public record RouteHazardsResponse(
        List<HazardResponse> hazards,
        boolean complete,
        boolean truncated,
        boolean leavesCoverageArea,
        double corridorMeters
) {
}
