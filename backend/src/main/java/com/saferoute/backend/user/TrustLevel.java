package com.saferoute.backend.user;

/** Display tier derived from reputation (review §7) — shown instead of the raw score. */
public enum TrustLevel {
    NEW_REPORTER,
    REGULAR_REPORTER,
    TRUSTED_REPORTER;

    public static final int REGULAR_THRESHOLD = 10;
    public static final int TRUSTED_THRESHOLD = 50;

    public static TrustLevel fromScore(int score) {
        if (score >= TRUSTED_THRESHOLD) return TRUSTED_REPORTER;
        if (score >= REGULAR_THRESHOLD) return REGULAR_REPORTER;
        return NEW_REPORTER;
    }
}
