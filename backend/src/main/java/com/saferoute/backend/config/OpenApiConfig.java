package com.saferoute.backend.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI saferouteOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("SafeRoute API")
                        .version("0.2.0")
                        .description("""
                                Event-driven pedestrian hazard reporting.

                                **Auth:** every endpoint except /api/auth/register|login|refresh|logout needs \
                                `Authorization: Bearer <access token>`. Access tokens last 30 minutes; use \
                                POST /api/auth/refresh with the refresh token (rotated on every use).

                                **Asynchronous commands:** reports, confirmations, resolution votes and \
                                moderator resolution return **202 Accepted** and are applied by a Kafka \
                                consumer. Results arrive over the WebSocket at /ws/notifications \
                                (`hazard_*` and `submission_processed` frames), or poll \
                                GET /api/hazard-submissions/{id}.

                                **Errors:** `{"status":409,"error":"SELF_CONFIRMATION_NOT_ALLOWED","message":"..."}` — \
                                `error` is a stable code. Rate-limited calls return **429** with a \
                                `Retry-After` header and `retryAfterSeconds`."""))
                .components(new Components().addSecuritySchemes("bearer",
                        new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList("bearer"));
    }
}
