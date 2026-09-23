package com.saferoute.backend.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @NotBlank @Email @Size(max = 255) String email,
        @NotBlank @Size(min = 8, max = 128, message = "must be between 8 and 128 characters") String password,
        @NotBlank @Size(max = 60) String displayName
) {
}
