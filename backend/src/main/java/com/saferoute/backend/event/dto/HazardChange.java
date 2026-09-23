package com.saferoute.backend.event.dto;

public enum HazardChange {
    CREATED,
    CONFIRMATIONS_CHANGED,
    VERIFIED,
    DISPUTED,
    /** DISPUTED -> REPORTED/VERIFIED, or a moderator reopen. */
    REINSTATED,
    RESOLVED,
    EXPIRED,
    REMOVED,
    EDITED,
    DUPLICATE_MERGED
}
