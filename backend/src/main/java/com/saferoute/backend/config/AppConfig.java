package com.saferoute.backend.config;

import com.saferoute.backend.coverage.CoverageArea;
import com.saferoute.backend.hazard.ExpiryPolicy;
import com.saferoute.backend.ratelimit.RateLimitProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
@EnableConfigurationProperties({RateLimitProperties.class, ExpiryPolicy.class, CoverageArea.class})
public class AppConfig {
}
