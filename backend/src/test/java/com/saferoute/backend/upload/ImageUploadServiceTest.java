package com.saferoute.backend.upload;

import com.saferoute.backend.common.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ImageUploadServiceTest {

    private static final UUID OWNER = UUID.randomUUID();
    private static final UUID SOMEONE_ELSE = UUID.randomUUID();

    @TempDir
    Path tempDir;

    JdbcTemplate jdbc;
    ImageUploadService service;

    @BeforeEach
    void setUp() throws Exception {
        jdbc = mock(JdbcTemplate.class);
        service = new ImageUploadService(tempDir.toString(), Duration.ofHours(24), jdbc);
    }

    @Test
    void acceptsPngAndReEncodesAsDownscaledJpeg() throws Exception {
        var stored = service.storeHazardImage(new MockMultipartFile("file", "a.png", "image/png", png(3200, 1600)), OWNER);

        assertThat(stored.url()).matches("/uploads/hazards/[0-9a-f-]{36}\\.jpg");
        assertThat(stored.width()).isEqualTo(1600);
        assertThat(stored.height()).isEqualTo(800);
        byte[] bytes = Files.readAllBytes(storedFile(stored));
        assertThat(bytes[0] & 0xFF).isEqualTo(0xFF);
        assertThat(bytes[1] & 0xFF).isEqualTo(0xD8);
        verify(jdbc).update(startsWith("INSERT INTO uploads"), eq(stored.url()), eq(OWNER));
    }

    @Test
    void stripsARealExifGpsPayload() throws Exception {
        byte[] withGps = jpegWithExifGps();
        // The fixture really carries an APP1/Exif segment with GPS data...
        assertThat(segmentMarkers(withGps)).contains(0xE1);
        assertThat(latin1(withGps)).contains("Exif");
        assertThat(indexOf(withGps, GPS_LATITUDE_BYTES)).isNotNegative();

        var stored = service.storeHazardImage(new MockMultipartFile("file", "gps.jpg", "image/jpeg", withGps), OWNER);

        // ...and the stored image, parsed segment by segment, carries none of it.
        byte[] out = Files.readAllBytes(storedFile(stored));
        assertThat(segmentMarkers(out)).doesNotContain(0xE1);
        assertThat(latin1(out)).doesNotContain("Exif");
        assertThat(indexOf(out, GPS_LATITUDE_BYTES)).isNegative();
        assertThat(ImageIO.read(storedFile(stored).toFile())).isNotNull();
    }

    @Test
    void onlyTheUploaderCanAttachAnUpload() throws Exception {
        var stored = service.storeHazardImage(new MockMultipartFile("file", "a.png", "image/png", png(10, 10)), OWNER);
        when(jdbc.queryForObject(contains("FROM uploads"), eq(Boolean.class), eq(stored.url()), eq(OWNER))).thenReturn(true);
        when(jdbc.queryForObject(contains("FROM uploads"), eq(Boolean.class), eq(stored.url()), eq(SOMEONE_ELSE))).thenReturn(false);

        service.requireOwnedUpload(stored.url(), OWNER);
        assertThatThrownBy(() -> service.requireOwnedUpload(stored.url(), SOMEONE_ELSE))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getCode()).isEqualTo("INVALID_PHOTO_URL"));
    }

    @Test
    void rejectsDisallowedMimeType() throws Exception {
        assertThatThrownBy(() -> service.storeHazardImage(new MockMultipartFile("file", "a.gif", "image/gif", png(10, 10)), OWNER))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE));
    }

    @Test
    void rejectsNonImageContentDisguisedAsJpeg() {
        byte[] script = "#!/bin/sh\nrm -rf /\n".getBytes();
        assertThatThrownBy(() -> service.storeHazardImage(new MockMultipartFile("file", "x.jpg", "image/jpeg", script), OWNER))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE));
    }

    @Test
    void rejectsOversizedFiles() {
        byte[] big = new byte[5 * 1024 * 1024 + 1];
        big[0] = (byte) 0xFF; big[1] = (byte) 0xD8; big[2] = (byte) 0xFF;
        assertThatThrownBy(() -> service.storeHazardImage(new MockMultipartFile("file", "big.jpg", "image/jpeg", big), OWNER))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));
    }

    @Test
    void rejectsForeignPhotoUrls() {
        assertThatThrownBy(() -> service.requireOwnedUpload("https://evil.example/x.jpg", OWNER)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.requireOwnedUpload("/uploads/hazards/../../etc/passwd", OWNER)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.requireOwnedUpload("/uploads/hazards/00000000-0000-0000-0000-000000000000.jpg", OWNER))
                .isInstanceOf(ApiException.class);
    }

    // ------------------------------------------------------------------ fixtures

    /** GPSLatitude 14° 33' 17.17" as three big-endian RATIONALs — distinctive enough to search for. */
    private static final byte[] GPS_LATITUDE_BYTES = ByteBuffer.allocate(24)
            .putInt(14).putInt(1).putInt(33).putInt(1).putInt(1717).putInt(100).array();

    private Path storedFile(ImageUploadService.StoredImage stored) {
        return tempDir.resolve("hazards").resolve(stored.url().substring("/uploads/hazards/".length()));
    }

    static byte[] png(int w, int h) throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB), "png", out);
        return out.toByteArray();
    }

    /** A real JPEG with an APP1 Exif segment whose IFD0 points to a GPS IFD (GPSLatitudeRef + GPSLatitude). */
    static byte[] jpegWithExifGps() throws Exception {
        var jpeg = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(64, 48, BufferedImage.TYPE_INT_RGB), "jpeg", jpeg);
        byte[] plain = jpeg.toByteArray();

        ByteBuffer tiff = ByteBuffer.allocate(80);           // big-endian by default
        tiff.put("MM".getBytes(StandardCharsets.US_ASCII)).putShort((short) 42).putInt(8);
        // IFD0 at 8: one entry, GPSInfo (0x8825) LONG pointer to the GPS IFD at 26.
        tiff.putShort((short) 1).putShort((short) 0x8825).putShort((short) 4).putInt(1).putInt(26).putInt(0);
        // GPS IFD at 26: GPSLatitudeRef "N", GPSLatitude -> 3 RATIONALs at 56.
        tiff.putShort((short) 2);
        tiff.putShort((short) 0x0001).putShort((short) 2).putInt(2).put(new byte[]{'N', 0, 0, 0});
        tiff.putShort((short) 0x0002).putShort((short) 5).putInt(3).putInt(56);
        tiff.putInt(0);
        tiff.put(GPS_LATITUDE_BYTES);
        byte[] tiffBytes = new byte[tiff.position()];
        tiff.flip().get(tiffBytes);

        byte[] exifHeader = "Exif\0\0".getBytes(StandardCharsets.US_ASCII);
        int length = 2 + exifHeader.length + tiffBytes.length;
        var out = new ByteArrayOutputStream();
        out.write(plain, 0, 2);                                // SOI
        out.write(0xFF);
        out.write(0xE1);                                        // APP1
        out.write(length >> 8);
        out.write(length & 0xFF);
        out.write(exifHeader);
        out.write(tiffBytes);
        out.write(plain, 2, plain.length - 2);
        return out.toByteArray();
    }

    /** Marker bytes of every segment before the image data (SOS). */
    static List<Integer> segmentMarkers(byte[] jpeg) {
        List<Integer> markers = new ArrayList<>();
        int i = 2;
        while (i + 3 < jpeg.length && (jpeg[i] & 0xFF) == 0xFF) {
            int marker = jpeg[i + 1] & 0xFF;
            markers.add(marker);
            if (marker == 0xDA) break;
            int length = ((jpeg[i + 2] & 0xFF) << 8) | (jpeg[i + 3] & 0xFF);
            i += 2 + length;
        }
        return markers;
    }

    private static String latin1(byte[] bytes) {
        return new String(bytes, StandardCharsets.ISO_8859_1);
    }

    private static int indexOf(byte[] haystack, byte[] needle) {
        outer:
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) continue outer;
            }
            return i;
        }
        return -1;
    }
}
