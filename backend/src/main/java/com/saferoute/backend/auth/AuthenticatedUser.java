package com.saferoute.backend.auth;

import com.saferoute.backend.user.Role;

import java.util.UUID;

/** Principal placed into the SecurityContext by {@link JwtAuthFilter} after validating a JWT. */
public record AuthenticatedUser(UUID id, String email, Role role) {

    public boolean canModerate() {
        return role != null && role.canModerate();
    }
}
