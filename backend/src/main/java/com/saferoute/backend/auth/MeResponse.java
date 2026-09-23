package com.saferoute.backend.auth;

import com.saferoute.backend.user.Role;
import com.saferoute.backend.user.TrustLevel;
import com.saferoute.backend.user.User;

import java.util.UUID;

public record MeResponse(UUID id, String email, String displayName, Role role,
                         int reputationScore, TrustLevel trustLevel) {

    public static MeResponse from(User user) {
        return new MeResponse(user.getId(), user.getEmail(), user.getDisplayName(), user.getRole(),
                user.getReputationScore(), user.trustLevel());
    }
}
