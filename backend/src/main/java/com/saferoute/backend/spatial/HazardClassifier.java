package com.saferoute.backend.spatial;

import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.hazard.Severity;

import java.util.List;

/** Deterministic classification strategy, deliberately isolated so a smarter model can be swapped in later. */
public interface HazardClassifier {

    record Option(String value, String label, Severity severity) {
    }

    record Question(HazardType type, String prompt, List<Option> options) {
    }

    /** @param answer the reporter's answer to {@link #questionFor}, or null if skipped */
    Severity classify(HazardType type, String answer);

    Question questionFor(HazardType type);

    default boolean isValidAnswer(HazardType type, String answer) {
        return answer == null || questionFor(type).options().stream().anyMatch(o -> o.value().equals(answer));
    }
}
