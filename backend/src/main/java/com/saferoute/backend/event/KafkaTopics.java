package com.saferoute.backend.event;

/**
 * Command topics (consumed by the Hazard Processing module) keep the paper's event vocabulary;
 * outcome topics are what the Notification module fans out over WebSockets.
 */
public final class KafkaTopics {

    // Commands
    public static final String HAZARD_REPORTED = "hazard_reported";
    /** A user's VERIFY/DISPUTE opinion was set or changed. */
    public static final String HAZARD_VERIFIED = "hazard_verified";
    public static final String HAZARD_RESOLUTION_REQUESTED = "hazard_resolution_requested";
    /** Moderator/official resolution. */
    public static final String HAZARD_RESOLVED = "hazard_resolved";

    // Outcomes
    public static final String HAZARD_CREATED = "hazard_created";
    /** Any state change of an existing hazard; the payload's {@code change} says which. */
    public static final String HAZARD_UPDATED = "hazard_updated";
    public static final String SUBMISSION_PROCESSED = "submission_processed";

    public static final String DLQ_SUFFIX = ".dlq";

    private KafkaTopics() {
    }
}
