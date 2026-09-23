package com.saferoute.backend.submission;

public enum SubmissionStatus {
    /** Accepted by the API, waiting for (or inside) the Hazard Processing consumer. */
    QUEUED,
    /** Became a new canonical hazard. */
    CREATED,
    /** Matched an existing hazard; the report was added to it as a confirmation. */
    MERGED,
    /** Could not be processed after retries (see the hazard_reported.dlq topic). */
    FAILED;

    public boolean isTerminal() {
        return this == CREATED || this == MERGED || this == FAILED;
    }
}
