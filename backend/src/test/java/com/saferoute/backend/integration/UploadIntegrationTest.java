package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

class UploadIntegrationTest extends IntegrationTestBase {

    @Test
    void uploadedPhotoCanBeAttachedToAReportAndServed() throws Exception {
        TestUser user = registerUser();
        JsonNode stored = json(mvc.perform(multipart("/api/uploads/hazard-image")
                .file(new MockMultipartFile("file", "p.jpg", "image/jpeg", jpeg())).with(bearer(user))).andReturn(), 201);
        String url = stored.get("url").asText();

        var served = mvc.perform(get(url)).andReturn();
        assertThat(served.getResponse().getStatus()).isEqualTo(200);
        assertThat(served.getResponse().getContentType()).isEqualTo("image/jpeg");

        Location at = freshLocation();
        JsonNode submission = awaitSubmission(user, submit(user, Map.of("type", "OPEN_MANHOLE",
                "latitude", at.lat(), "longitude", at.lon(), "photoUrl", url)));
        assertThat(hazardDetail(user, UUID.fromString(submission.get("hazardId").asText())).at("/hazard/photoUrl").asText())
                .isEqualTo(url);
    }

    @Test
    void invalidUploadsAreRejected() throws Exception {
        TestUser user = registerUser();
        json(mvc.perform(multipart("/api/uploads/hazard-image")
                .file(new MockMultipartFile("file", "a.txt", "text/plain", "hello".getBytes())).with(bearer(user))).andReturn(), 415);
        json(mvc.perform(multipart("/api/uploads/hazard-image")
                .file(new MockMultipartFile("file", "fake.jpg", "image/jpeg", "<?php echo 1; ?>".getBytes())).with(bearer(user))).andReturn(), 415);
        byte[] big = new byte[6 * 1024 * 1024];
        big[0] = (byte) 0xFF; big[1] = (byte) 0xD8; big[2] = (byte) 0xFF;
        json(mvc.perform(multipart("/api/uploads/hazard-image")
                .file(new MockMultipartFile("file", "big.jpg", "image/jpeg", big)).with(bearer(user))).andReturn(), 413);
    }

    @Test
    void foreignPhotoUrlsAreRejectedOnSubmission() throws Exception {
        TestUser user = registerUser();
        Location at = freshLocation();
        JsonNode body = json(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/hazard-submissions")
                .with(bearer(user)).contentType("application/json")
                .content(toJson(Map.of("type", "FLOODING", "latitude", at.lat(), "longitude", at.lon(),
                        "photoUrl", "https://tracker.example/pixel.jpg")))).andReturn(), 400);
        assertThat(body.get("error").asText()).isEqualTo("INVALID_PHOTO_URL");
    }

    private static byte[] jpeg() throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(40, 30, BufferedImage.TYPE_INT_RGB), "jpg", out);
        return out.toByteArray();
    }
}
