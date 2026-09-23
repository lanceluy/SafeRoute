package com.saferoute.backend.config;

import com.saferoute.backend.upload.ImageUploadService;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.concurrent.TimeUnit;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final ImageUploadService uploadService;

    public WebConfig(ImageUploadService uploadService) {
        this.uploadService = uploadService;
    }

    /** Serves uploaded photos. Filenames are random UUIDs and files are immutable, so cache hard. */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler(ImageUploadService.URL_PREFIX + "**")
                .addResourceLocations(uploadService.hazardDirectory().toUri().toString())
                .setCacheControl(org.springframework.http.CacheControl.maxAge(30, TimeUnit.DAYS).cachePublic());
    }
}
