package com.saferoute.backend.coverage;

import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.spatial.HazardClassifier;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
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

    private final CoverageArea coverageArea;
    private final HazardClassifier classifier;

    public MetaController(CoverageArea coverageArea, HazardClassifier classifier) {
        this.coverageArea = coverageArea;
        this.classifier = classifier;
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
