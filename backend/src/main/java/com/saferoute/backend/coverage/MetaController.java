package com.saferoute.backend.coverage;

import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.spatial.HazardClassifier;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.List;

@RestController
@RequestMapping("/api/meta")
@Tag(name = "Meta", description = "Static configuration the client renders from")
public class MetaController {

    public record CoverageResponse(boolean enabled, String name, double minLat, double maxLat, double minLon, double maxLon) {
    }

    /**
     * @param routeCorridorMeters a hazard this close to a route is "on" it — used for server-side
     *                            on-route alerts, route assessment and in-app navigation alike
     */
    public record RoutingResponse(double routeCorridorMeters) {
    }

    private final CoverageArea coverageArea;
    private final HazardClassifier classifier;
    private final double routeCorridorMeters;

    public MetaController(CoverageArea coverageArea, HazardClassifier classifier,
                          @Value("${saferoute.notification.route-corridor-meters}") double routeCorridorMeters) {
        this.coverageArea = coverageArea;
        this.classifier = classifier;
        this.routeCorridorMeters = routeCorridorMeters;
    }

    @GetMapping("/routing")
    @Operation(summary = "Shared routing parameters, so the client and server agree on what \"on the route\" means")
    public RoutingResponse routing() {
        return new RoutingResponse(routeCorridorMeters);
    }

    @GetMapping("/coverage")
    @Operation(summary = "The pilot service area reports must fall inside")
    public CoverageResponse coverage() {
        return new CoverageResponse(coverageArea.isEnabled(), coverageArea.getName(),
                coverageArea.getMinLat(), coverageArea.getMaxLat(), coverageArea.getMinLon(), coverageArea.getMaxLon());
    }

    @GetMapping("/severity-questions")
    @Operation(summary = "The structured question asked per hazard type, and how each answer maps to severity")
    public List<HazardClassifier.Question> severityQuestions() {
        return Arrays.stream(HazardType.values()).map(classifier::questionFor).toList();
    }
}
