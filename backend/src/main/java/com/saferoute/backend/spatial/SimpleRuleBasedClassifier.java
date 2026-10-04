package com.saferoute.backend.spatial;

import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.hazard.Severity;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Rule-based severity from one structured, type-specific question — easier to
 * defend than ML and yields structured data. Falls back to a per-type default when skipped.
 */
@Component
public class SimpleRuleBasedClassifier implements HazardClassifier {

    private static final Map<HazardType, Severity> DEFAULTS = Map.ofEntries(
            Map.entry(HazardType.OPEN_MANHOLE, Severity.HIGH),
            Map.entry(HazardType.FLOODING, Severity.HIGH),
            Map.entry(HazardType.TRAFFIC_SIGNAL_OUTAGE, Severity.HIGH),
            Map.entry(HazardType.ACCESSIBILITY_BARRIER, Severity.MEDIUM),
            Map.entry(HazardType.BROKEN_SIDEWALK, Severity.MEDIUM),
            Map.entry(HazardType.CONSTRUCTION, Severity.MEDIUM),
            Map.entry(HazardType.PATH_OBSTRUCTION, Severity.MEDIUM),
            Map.entry(HazardType.FALLEN_TREE, Severity.MEDIUM),
            Map.entry(HazardType.VEHICLE_BLOCKING_SIDEWALK, Severity.MEDIUM),
            Map.entry(HazardType.ROAD_DEBRIS, Severity.MEDIUM),
            Map.entry(HazardType.CROSSWALK_ISSUE, Severity.MEDIUM),
            Map.entry(HazardType.SAFETY_CONCERN, Severity.MEDIUM),
            Map.entry(HazardType.POOR_LIGHTING, Severity.LOW)
    );

    private static final List<Option> PASSABILITY = List.of(
            new Option("PASSABLE", "Easily", Severity.LOW),
            new Option("DIFFICULT", "With difficulty", Severity.MEDIUM),
            new Option("BLOCKED", "No", Severity.HIGH));

    private static final Map<HazardType, Question> QUESTIONS = Map.ofEntries(
            question(HazardType.FLOODING, "How deep is the water?",
                    new Option("ANKLE_LEVEL", "Ankle level", Severity.MEDIUM),
                    new Option("SHIN_LEVEL", "Shin level", Severity.HIGH),
                    new Option("KNEE_OR_HIGHER", "Knee level or higher", Severity.HIGH)),
            question(HazardType.BROKEN_SIDEWALK, "Can pedestrians pass?", PASSABILITY),
            question(HazardType.POOR_LIGHTING, "How dark is it?",
                    new Option("DIM", "Dim", Severity.LOW),
                    new Option("VERY_DARK", "Very dark", Severity.MEDIUM),
                    new Option("COMPLETELY_UNLIT", "Completely unlit", Severity.HIGH)),
            question(HazardType.OPEN_MANHOLE, "Where is it relative to the walking path?",
                    new Option("OFF_PATH", "Off the walking path", Severity.MEDIUM),
                    new Option("PARTLY_OBSTRUCTING", "Partly obstructing the path", Severity.HIGH),
                    new Option("IN_PATH", "Directly in the walking path", Severity.HIGH)),
            question(HazardType.ACCESSIBILITY_BARRIER, "Can wheelchair users pass?", PASSABILITY),
            question(HazardType.CONSTRUCTION, "Is the sidewalk still usable?",
                    new Option("SIDEWALK_OPEN", "Open", Severity.LOW),
                    new Option("SIDEWALK_NARROWED", "Narrowed", Severity.MEDIUM),
                    new Option("SIDEWALK_CLOSED", "Closed — must walk on the road", Severity.HIGH)),
            question(HazardType.PATH_OBSTRUCTION, "Can pedestrians pass?", PASSABILITY),
            question(HazardType.TRAFFIC_SIGNAL_OUTAGE, "What is the signal doing?",
                    new Option("PEDESTRIAN_SIGNAL_ONLY", "Only the walk signal is out", Severity.MEDIUM),
                    new Option("FLASHING_OR_STUCK", "Flashing or stuck", Severity.MEDIUM),
                    new Option("COMPLETELY_OUT", "Completely out", Severity.HIGH)),
            question(HazardType.FALLEN_TREE, "Can pedestrians pass?", PASSABILITY),
            question(HazardType.VEHICLE_BLOCKING_SIDEWALK, "Can pedestrians pass?", PASSABILITY),
            question(HazardType.ROAD_DEBRIS, "What is it?",
                    new Option("SMALL_DEBRIS", "Small debris", Severity.LOW),
                    new Option("SPILL_OR_SLICK", "A spill or slippery patch", Severity.MEDIUM),
                    new Option("LARGE_OR_HAZARDOUS", "A large obstacle or hazardous material", Severity.HIGH)),
            question(HazardType.CROSSWALK_ISSUE, "What is wrong with the crosswalk?",
                    new Option("FADED_MARKINGS", "Markings are faded", Severity.LOW),
                    new Option("PARTLY_BLOCKED", "Partly blocked", Severity.MEDIUM),
                    new Option("MISSING_OR_BLOCKED", "Missing or fully blocked", Severity.HIGH)),
            question(HazardType.SAFETY_CONCERN, "What best describes it?",
                    new Option("SUSPICIOUS_ACTIVITY", "Suspicious activity", Severity.LOW),
                    new Option("HARASSMENT_OR_THEFT", "Harassment or theft", Severity.MEDIUM),
                    new Option("ACTIVE_THREAT", "Violence or an active threat", Severity.HIGH))
    );

    private static Map.Entry<HazardType, Question> question(HazardType type, String text, Option... options) {
        return question(type, text, List.of(options));
    }

    private static Map.Entry<HazardType, Question> question(HazardType type, String text, List<Option> options) {
        return Map.entry(type, new Question(type, text, options));
    }

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
