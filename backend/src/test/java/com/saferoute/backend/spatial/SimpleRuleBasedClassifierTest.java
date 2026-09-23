package com.saferoute.backend.spatial;

import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.hazard.Severity;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SimpleRuleBasedClassifierTest {

    private final SimpleRuleBasedClassifier classifier = new SimpleRuleBasedClassifier();

    @Test
    void everyTypeHasAQuestion() {
        for (HazardType type : HazardType.values()) {
            assertThat(classifier.questionFor(type)).as(type.name()).isNotNull();
            assertThat(classifier.questionFor(type).options()).isNotEmpty();
        }
    }

    @Test
    void answersDriveSeverity() {
        assertThat(classifier.classify(HazardType.FLOODING, "ANKLE_LEVEL")).isEqualTo(Severity.MEDIUM);
        assertThat(classifier.classify(HazardType.FLOODING, "KNEE_OR_HIGHER")).isEqualTo(Severity.HIGH);
        assertThat(classifier.classify(HazardType.BROKEN_SIDEWALK, "PASSABLE")).isEqualTo(Severity.LOW);
        assertThat(classifier.classify(HazardType.BROKEN_SIDEWALK, "BLOCKED")).isEqualTo(Severity.HIGH);
        assertThat(classifier.classify(HazardType.POOR_LIGHTING, "COMPLETELY_UNLIT")).isEqualTo(Severity.HIGH);
        assertThat(classifier.classify(HazardType.OPEN_MANHOLE, "OFF_PATH")).isEqualTo(Severity.MEDIUM);
    }

    @Test
    void skippedQuestionFallsBackToTypeDefault() {
        assertThat(classifier.classify(HazardType.OPEN_MANHOLE, null)).isEqualTo(Severity.HIGH);
        assertThat(classifier.classify(HazardType.POOR_LIGHTING, null)).isEqualTo(Severity.LOW);
    }

    @Test
    void answersAreValidatedPerType() {
        assertThat(classifier.isValidAnswer(HazardType.FLOODING, null)).isTrue();
        assertThat(classifier.isValidAnswer(HazardType.FLOODING, "SHIN_LEVEL")).isTrue();
        assertThat(classifier.isValidAnswer(HazardType.FLOODING, "BLOCKED")).isFalse();
    }
}
