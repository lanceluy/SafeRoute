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
    DUPLICATE_MERGED,
    /** A staff member marked it reviewed (stopping the archive clock, or bringing it back from Archived). */
    REVIEWED,
    /** A week passed without staff review; out of the portal's working queues, still on the map. */
    ARCHIVED
}
