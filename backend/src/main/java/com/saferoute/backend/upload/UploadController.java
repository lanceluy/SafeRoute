package com.saferoute.backend.upload;

import com.saferoute.backend.auth.AuthenticatedUser;
import com.saferoute.backend.ratelimit.RateLimitPolicy;
import com.saferoute.backend.ratelimit.RateLimitService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/uploads")
@Tag(name = "Uploads")
public class UploadController {

    private final ImageUploadService uploadService;
    private final RateLimitService rateLimitService;

    public UploadController(ImageUploadService uploadService, RateLimitService rateLimitService) {
        this.uploadService = uploadService;
        this.rateLimitService = rateLimitService;
    }

    @PostMapping(path = "/hazard-image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Upload a hazard photo",
            description = "Multipart field `file`. JPEG/PNG only, max 5 MB. The image is re-encoded as JPEG "
                    + "(max 1600 px) with all metadata stripped. Use the returned url as photoUrl. 10 uploads/hour/user.")
    public ResponseEntity<ImageUploadService.StoredImage> uploadHazardImage(@RequestParam("file") MultipartFile file,
                                                                            @AuthenticationPrincipal AuthenticatedUser principal) {
        rateLimitService.consume(RateLimitPolicy.IMAGE_UPLOAD, principal.id().toString());
        return ResponseEntity.status(HttpStatus.CREATED).body(uploadService.storeHazardImage(file));
    }
}
