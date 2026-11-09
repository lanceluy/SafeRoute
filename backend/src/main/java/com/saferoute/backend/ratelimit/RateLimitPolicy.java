package com.saferoute.backend.ratelimit;

/** The rate limits promised by the paper (Section 1.4). */
public enum RateLimitPolicy {
    LOGIN_FAILURE("login attempts"),
    REGISTER("registrations"),
    HAZARD_REPORT("hazard reports"),
    CONFIRMATION("verifications/disputes"),
    RESOLUTION("resolution requests"),
    IMAGE_UPLOAD("image uploads"),
    /** Accounts below the Regular reputation tier: see AccountStatusService. */
    HAZARD_REPORT_NEW_ACCOUNT("hazard reports from new accounts"),
    CONFIRMATION_NEW_ACCOUNT("verifications/disputes from new accounts");

    private final String description;

    RateLimitPolicy(String description) {
        this.description = description;
    }

    public String description() {
        return description;
    }
}
