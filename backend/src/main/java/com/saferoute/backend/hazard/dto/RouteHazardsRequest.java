package com.saferoute.backend.hazard.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * @param routes        candidate routes, each a list of [latitude, longitude] points
 * @param corridorMeters optional; defaults to the server's route corridor (the same one used for
 *                       on-route alerts), so planning, navigation and alerts agree
 */
public record RouteHazardsRequest(
        @NotEmpty @Size(max = 20) List<List<double[]>> routes,
        Double corridorMeters
) {
}
