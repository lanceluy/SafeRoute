package com.saferoute.backend.user;

import com.saferoute.backend.auth.AuthenticatedUser;
import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.common.PageResponse;
import com.saferoute.backend.hazard.HazardService;
import com.saferoute.backend.hazard.dto.MyReportResponse;
import com.saferoute.backend.push.PushDeviceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/me")
@Tag(name = "Me", description = "The signed-in user's reports, profile and preferences")
public class MeController {

    public record PreferencesRequest(@Min(100) @Max(5000) int radiusMeters,
                                     java.util.Set<com.saferoute.backend.hazard.HazardType> enabledTypes) {
    }

    public record PushDeviceRequest(@NotNull @Pattern(regexp = "^[0-9a-fA-F]{64,200}$") String deviceToken) {
    }

    public record DeviceLocationRequest(@DecimalMin("-90") @DecimalMax("90") double latitude,
                                        @DecimalMin("-180") @DecimalMax("180") double longitude) {
    }

    private final HazardService hazardService;
    private final ProfileService profileService;
    private final NotificationPreferencesService preferencesService;
    private final PushDeviceService pushDeviceService;

    public MeController(HazardService hazardService, ProfileService profileService,
                        NotificationPreferencesService preferencesService, PushDeviceService pushDeviceService) {
        this.hazardService = hazardService;
        this.profileService = profileService;
        this.preferencesService = preferencesService;
        this.pushDeviceService = pushDeviceService;
    }

    @GetMapping("/reports")
    @Operation(summary = "My Reports: every submission with its processing outcome and canonical hazard")
    public PageResponse<MyReportResponse> myReports(@AuthenticationPrincipal AuthenticatedUser principal,
                                                    @RequestParam(defaultValue = "0") int page,
                                                    @RequestParam(defaultValue = "20") int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "page must be >= 0 and size between 1 and 100");
        }
        return hazardService.myReports(principal.id(), page, size);
    }

    @GetMapping("/profile")
    @Operation(summary = "Trust level, contribution statistics and recent reputation activity")
    public ProfileService.ProfileResponse profile(@AuthenticationPrincipal AuthenticatedUser principal) {
        return profileService.profile(principal.id());
    }

    @GetMapping("/notification-preferences")
    public NotificationPreferencesService.PreferencesDto preferences(@AuthenticationPrincipal AuthenticatedUser principal) {
        return preferencesService.get(principal.id());
    }

    @PutMapping("/notification-preferences")
    @Operation(summary = "Alert radius (100–5000 m) and which hazard types trigger alerts")
    public NotificationPreferencesService.PreferencesDto updatePreferences(@AuthenticationPrincipal AuthenticatedUser principal,
                                                                           @Valid @RequestBody PreferencesRequest request) {
        return preferencesService.update(principal.id(),
                new NotificationPreferencesService.PreferencesDto(request.radiusMeters(), request.enabledTypes()));
    }

    @PutMapping("/push-device")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Register this device's APNs token for background hazard alerts")
    public void registerPushDevice(@AuthenticationPrincipal AuthenticatedUser principal,
                                   @Valid @RequestBody PushDeviceRequest request) {
        pushDeviceService.register(principal.id(), request.deviceToken());
    }

    @DeleteMapping("/push-device/{deviceToken}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Stop background alerts to this device (on logout or when the user turns them off)")
    public void unregisterPushDevice(@AuthenticationPrincipal AuthenticatedUser principal,
                                     @PathVariable String deviceToken) {
        pushDeviceService.unregister(principal.id(), deviceToken);
    }

    @PutMapping("/push-device/{deviceToken}/location")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Latest background location of a registered device",
            description = "Only the most recent point is kept, and it is cleared after saferoute.push.location-max-age.")
    public void updatePushDeviceLocation(@AuthenticationPrincipal AuthenticatedUser principal,
                                         @PathVariable String deviceToken,
                                         @Valid @RequestBody DeviceLocationRequest request) {
        pushDeviceService.updateLocation(principal.id(), deviceToken, request.latitude(), request.longitude());
    }
}
