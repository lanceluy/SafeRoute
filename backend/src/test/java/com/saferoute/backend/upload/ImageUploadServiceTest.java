package com.saferoute.backend.upload;

import com.saferoute.backend.common.ApiException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ImageUploadServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void acceptsPngAndReEncodesAsDownscaledJpeg() throws Exception {
        var service = new ImageUploadService(tempDir.toString());
        var stored = service.storeHazardImage(new MockMultipartFile("file", "a.png", "image/png", png(3200, 1600)));

        assertThat(stored.url()).matches("/uploads/hazards/[0-9a-f-]{36}\\.jpg");
        assertThat(stored.width()).isEqualTo(1600);
        assertThat(stored.height()).isEqualTo(800);
        Path file = tempDir.resolve("hazards").resolve(stored.url().substring("/uploads/hazards/".length()));
        byte[] bytes = Files.readAllBytes(file);
        assertThat(bytes[0] & 0xFF).isEqualTo(0xFF);
        assertThat(bytes[1] & 0xFF).isEqualTo(0xD8);
        // No APP1/Exif segment survives re-encoding.
        assertThat(new String(bytes, java.nio.charset.StandardCharsets.ISO_8859_1)).doesNotContain("Exif");
        service.requireExistingUpload(stored.url());
    }

    @Test
    void rejectsDisallowedMimeType() throws Exception {
        var service = new ImageUploadService(tempDir.toString());
        assertThatThrownBy(() -> service.storeHazardImage(new MockMultipartFile("file", "a.gif", "image/gif", png(10, 10))))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE));
    }

    @Test
    void rejectsNonImageContentDisguisedAsJpeg() throws Exception {
        var service = new ImageUploadService(tempDir.toString());
        byte[] script = "#!/bin/sh\nrm -rf /\n".getBytes();
        assertThatThrownBy(() -> service.storeHazardImage(new MockMultipartFile("file", "x.jpg", "image/jpeg", script)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE));
    }

    @Test
    void rejectsOversizedFiles() throws Exception {
        var service = new ImageUploadService(tempDir.toString());
        byte[] big = new byte[5 * 1024 * 1024 + 1];
        big[0] = (byte) 0xFF; big[1] = (byte) 0xD8; big[2] = (byte) 0xFF;
        assertThatThrownBy(() -> service.storeHazardImage(new MockMultipartFile("file", "big.jpg", "image/jpeg", big)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));
    }

    @Test
    void rejectsForeignPhotoUrls() throws Exception {
        var service = new ImageUploadService(tempDir.toString());
        assertThatThrownBy(() -> service.requireExistingUpload("https://evil.example/x.jpg")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.requireExistingUpload("/uploads/hazards/../../etc/passwd")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.requireExistingUpload("/uploads/hazards/00000000-0000-0000-0000-000000000000.jpg"))
                .isInstanceOf(ApiException.class);
    }

    static byte[] png(int w, int h) throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB), "png", out);
        return out.toByteArray();
    }
}
