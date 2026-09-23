package com.saferoute.backend.auth;

import com.saferoute.backend.user.Role;

import java.util.UUID;

/** {@code token} is the short-lived access token; {@code refreshToken} is rotated on every refresh. */
public record AuthResponse(String token, String refreshToken, long expiresInSeconds,
                           UUID userId, String email, String displayName, Role role) {
}
