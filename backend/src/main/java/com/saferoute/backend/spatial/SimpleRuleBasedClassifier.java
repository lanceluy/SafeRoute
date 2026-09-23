package com.saferoute.backend.spatial;

import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.hazard.Severity;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Rule-based severity from one structured, type-specific question (review §27) — easier to
 * defend than ML and yields structured data. Falls back to a per-type default when skipped.
 */
@Component
public class SimpleRuleBasedClassifier implements HazardClassifier {

    private static final Map<HazardType, Severity> DEFAULTS = Map.of(
            HazardType.OPEN_MANHOLE, Severity.HIGH,
            HazardType.FLOODING, Severity.HIGH,
            HazardType.ACCESSIBILITY_BARRIER, Severity.MEDIUM,
            HazardType.BROKEN_SIDEWALK, Severity.MEDIUM,
            HazardType.CONSTRUCTION, Severity.MEDIUM,
            HazardType.PATH_OBSTRUCTION, Severity.MEDIUM,
            HazardType.POOR_LIGHTING, Severity.LOW
    );

    private static final List<Option> PASSABILITY = List.of(
            new Option("PASSABLE", "Easily", Severity.LOW),
            new Option("DIFFICULT", "With difficulty", Severity.MEDIUM),
            new Option("BLOCKED", "No", Severity.HIGH));

    private static final Map<HazardType, Question> QUESTIONS = Map.of(
            HazardType.FLOODING, new Question(HazardType.FLOODING, "How deep is the water?", List.of(
                    new Option("ANKLE_LEVEL", "Ankle level", Severity.MEDIUM),
                    new Option("SHIN_LEVEL", "Shin level", Severity.HIGH),
                    new Option("KNEE_OR_HIGHER", "Knee level or higher", Severity.HIGH))),
            HazardType.BROKEN_SIDEWALK, new Question(HazardType.BROKEN_SIDEWALK, "Can pedestrians pass?", PASSABILITY),
            HazardType.POOR_LIGHTING, new Question(HazardType.POOR_LIGHTING, "How dark is it?", List.of(
                    new Option("DIM", "Dim", Severity.LOW),
                    new Option("VERY_DARK", "Very dark", Severity.MEDIUM),
                    new Option("COMPLETELY_UNLIT", "Completely unlit", Severity.HIGH))),
            HazardType.OPEN_MANHOLE, new Question(HazardType.OPEN_MANHOLE, "Where is it relative to the walking path?", List.of(
                    new Option("OFF_PATH", "Off the walking path", Severity.MEDIUM),
                    new Option("PARTLY_OBSTRUCTING", "Partly obstructing the path", Severity.HIGH),
                    new Option("IN_PATH", "Directly in the walking path", Severity.HIGH))),
            HazardType.ACCESSIBILITY_BARRIER, new Question(HazardType.ACCESSIBILITY_BARRIER, "Can wheelchair users pass?", PASSABILITY),
            HazardType.CONSTRUCTION, new Question(HazardType.CONSTRUCTION, "Is the sidewalk still usable?", List.of(
                    new Option("SIDEWALK_OPEN", "Open", Severity.LOW),
                    new Option("SIDEWALK_NARROWED", "Narrowed", Severity.MEDIUM),
                    new Option("SIDEWALK_CLOSED", "Closed — must walk on the road", Severity.HIGH))),
            HazardType.PATH_OBSTRUCTION, new Question(HazardType.PATH_OBSTRUCTION, "Can pedestrians pass?", PASSABILITY)
    );

    @Override
    public Severity classify(HazardType type, String answer) {
        if (answer != null) {
            for (Option option : questionFor(type).options()) {
                if (option.value().equals(answer)) return option.severity();
            }
        }
        return DEFAULTS.getOrDefault(type, Severity.MEDIUM);
    }

    @Override
    public Question questionFor(HazardType type) {
        return QUESTIONS.get(type);
    }
}
