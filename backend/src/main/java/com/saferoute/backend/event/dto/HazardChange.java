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
    /** A department was assigned or the municipal priority changed. */
    MUNICIPAL_RESPONSE,
    DUPLICATE_MERGED
}
