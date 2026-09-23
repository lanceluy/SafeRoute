package com.saferoute.backend.user;

public enum Role {
    USER,
    MODERATOR,
    MUNICIPAL_OFFICIAL;

    /** Moderators and municipal officials may resolve, reopen and remove hazards directly. */
    public boolean canModerate() {
        return this == MODERATOR || this == MUNICIPAL_OFFICIAL;
    }
}
