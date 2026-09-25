package com.saferoute.backend.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {

    @Test
    void refusesToStartWithoutASecret() {
        assertThatThrownBy(() -> JwtService.resolveSecret("", false)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> JwtService.resolveSecret(null, false)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void refusesThePublishedDevelopmentKeyOutsideDevelopment() {
        assertThatThrownBy(() -> JwtService.resolveSecret(JwtService.DEV_SECRET, false)).isInstanceOf(IllegalStateException.class);
        assertThat(JwtService.resolveSecret(JwtService.DEV_SECRET, true)).isEqualTo(JwtService.DEV_SECRET);
        assertThat(JwtService.resolveSecret("", true)).isEqualTo(JwtService.DEV_SECRET);
    }

    @Test
    void refusesShortSecrets() {
        assertThatThrownBy(() -> JwtService.resolveSecret("too-short", false)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void acceptsAPrivateSecret() {
        String secret = "a-private-deployment-secret-that-is-long-enough-1234";
        assertThat(JwtService.resolveSecret(secret, false)).isEqualTo(secret);
    }
}
