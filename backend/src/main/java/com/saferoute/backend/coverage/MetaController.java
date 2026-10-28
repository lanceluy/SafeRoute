package com.saferoute.backend.coverage;

import com.saferoute.backend.moderation.MunicipalDepartments;
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
    public record RoutingResponse(double routeCorridorMeters, double weightHigh, double weightMedium,
                                  double weightLow, double closurePenalty) {
    }

    private final CoverageArea coverageArea;
    private final HazardClassifier classifier;
    private final double routeCorridorMeters;
    private final MunicipalDepartments departments;
    private final double weightHigh;
    private final double weightMedium;
    private final double weightLow;
    private final double closurePenalty;

    public MetaController(CoverageArea coverageArea, HazardClassifier classifier, MunicipalDepartments departments,
                          @Value("${saferoute.notification.route-corridor-meters}") double routeCorridorMeters,
                          @Value("${saferoute.routing.weight-high}") double weightHigh,
                          @Value("${saferoute.routing.weight-medium}") double weightMedium,
                          @Value("${saferoute.routing.weight-low}") double weightLow,
                          @Value("${saferoute.routing.closure-penalty}") double closurePenalty) {
        this.departments = departments;
        this.coverageArea = coverageArea;
        this.classifier = classifier;
        this.routeCorridorMeters = routeCorridorMeters;
        this.weightHigh = weightHigh;
        this.weightMedium = weightMedium;
        this.weightLow = weightLow;
        this.closurePenalty = closurePenalty;
    }

    @GetMapping("/routing")
    @Operation(summary = "Shared routing parameters, so the client and server agree on what \"on the route\" means")
    public RoutingResponse routing() {
        return new RoutingResponse(routeCorridorMeters, weightHigh, weightMedium, weightLow, closurePenalty);
    }

    @GetMapping("/coverage")
    @Operation(summary = "The pilot service area reports must fall inside")
    public CoverageResponse coverage() {
        return new CoverageResponse(coverageArea.isEnabled(), coverageArea.getName(),
                coverageArea.getMinLat(), coverageArea.getMaxLat(), coverageArea.getMinLon(), coverageArea.getMaxLon());
    }

    @GetMapping("/departments")
    @Operation(summary = "City departments a hazard can be assigned to, in display order")
    public List<MunicipalDepartments.Department> departments() {
        return departments.list();
    }

    @GetMapping("/severity-questions")
    @Operation(summary = "The structured question asked per hazard type, and how each answer maps to severity")
    public List<HazardClassifier.Question> severityQuestions() {
        return Arrays.stream(HazardType.values()).map(classifier::questionFor).toList();
    }
}
