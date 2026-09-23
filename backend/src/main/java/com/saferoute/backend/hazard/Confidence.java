package com.saferoute.backend.hazard;

public enum Confidence {
    /** Nobody besides the reporter has weighed in yet. */
    UNCONFIRMED,
    LOW,
    MEDIUM,
    HIGH,
    /** Community reports disagree. */
    CONTESTED
}
