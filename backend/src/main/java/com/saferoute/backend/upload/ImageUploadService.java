package com.saferoute.backend.upload;

import com.saferoute.backend.common.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Iterator;
import java.util.Set;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Local-disk image pipeline for the prototype. Every upload is decoded and re-encoded as a fresh
 * JPEG, which (a) proves it really is an image and (b) drops all metadata, including EXIF GPS
 * coordinates. It does not remove identifying content in the picture itself (faces, plates).
 * Swapping in object storage later only changes {@link #store}.
 *
 * <p>Ownership: each upload is recorded against its uploader, and only the uploader can attach it
 * to a report. Attached photos are public evidence (served by UUID URL to anyone who can see the
 * hazard); uploads never attached are deleted after {@code saferoute.uploads-cleanup.orphan-ttl}.
 */
@Service
public class ImageUploadService {

    public static final String URL_PREFIX = "/uploads/hazards/";
    private static final Pattern URL_PATTERN = Pattern.compile("^/uploads/hazards/[0-9a-f-]{36}\\.jpg$");
    private static final Set<String> ALLOWED_TYPES = Set.of("image/jpeg", "image/png");
    private static final long MAX_BYTES = 5 * 1024 * 1024;
    private static final int MAX_DIMENSION = 1600;
    private static final long MAX_SOURCE_PIXELS = 40_000_000L; // decompression-bomb guard
    private static final float JPEG_QUALITY = 0.85f;

    public record StoredImage(String url, int width, int height, long bytes) {
    }

    private static final Logger log = LoggerFactory.getLogger(ImageUploadService.class);

    private final Path hazardDir;
    private final JdbcTemplate jdbc;
    private final Duration orphanTtl;

    public ImageUploadService(@Value("${saferoute.uploads.dir}") String uploadsDir,
                              @Value("${saferoute.uploads-cleanup.orphan-ttl:PT24H}") Duration orphanTtl,
                              JdbcTemplate jdbc) throws IOException {
        this.hazardDir = Path.of(uploadsDir, "hazards").toAbsolutePath().normalize();
        this.orphanTtl = orphanTtl;
        this.jdbc = jdbc;
        Files.createDirectories(hazardDir);
    }

    public Path hazardDirectory() {
        return hazardDir;
    }

    public StoredImage storeHazardImage(MultipartFile file, UUID ownerId) {
        if (file == null || file.isEmpty()) {
            throw invalid("EMPTY_FILE", "No image was uploaded");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE", "Images must be 5 MB or smaller");
        }
        String declared = file.getContentType() != null ? file.getContentType().toLowerCase() : "";
        if (!ALLOWED_TYPES.contains(declared)) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "Only JPEG and PNG images are accepted");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw invalid("UNREADABLE_FILE", "Could not read the uploaded file");
        }
        if (!hasImageMagicBytes(bytes)) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "File content is not a JPEG or PNG image");
        }
        BufferedImage source = decode(bytes);
        BufferedImage resized = downscaleToRgb(source);
        StoredImage stored = store(resized);
        jdbc.update("INSERT INTO uploads (url, owner_id) VALUES (?, ?)", stored.url(), ownerId);
        return stored;
    }

    /**
     * Accepts null (no photo) or a URL this service issued to {@code userId} whose file still
     * exists. Someone else's photo URL is rejected even though it is publicly readable.
     */
    public void requireOwnedUpload(String url, UUID userId) {
        if (url == null) return;
        boolean valid = URL_PATTERN.matcher(url).matches()
                && Files.exists(hazardDir.resolve(url.substring(URL_PREFIX.length())))
                && Boolean.TRUE.equals(jdbc.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM uploads WHERE url = ? AND owner_id = ?)", Boolean.class, url, userId));
        if (!valid) {
            throw invalid("INVALID_PHOTO_URL", "photoUrl must be a URL returned to you by POST /api/uploads/hazard-image");
        }
    }

    /** Marks an upload as used by a report so the orphan cleanup keeps it. */
    public void markAttached(String url) {
        if (url == null) return;
        jdbc.update("UPDATE uploads SET attached_at = COALESCE(attached_at, now()) WHERE url = ?", url);
    }

    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT10M")
    public void deleteOrphanedUploads() {
        List<String> orphans = jdbc.queryForList(
                "SELECT url FROM uploads WHERE attached_at IS NULL AND created_at < now() - make_interval(secs => ?)",
                String.class, orphanTtl.toSeconds());
        for (String url : orphans) {
            try {
                Files.deleteIfExists(hazardDir.resolve(url.substring(URL_PREFIX.length())));
                jdbc.update("DELETE FROM uploads WHERE url = ? AND attached_at IS NULL", url);
            } catch (IOException e) {
                log.warn("Could not delete orphaned upload {}: {}", url, e.getMessage());
            }
        }
        if (!orphans.isEmpty()) log.info("Deleted {} orphaned upload(s)", orphans.size());
    }

    static boolean hasImageMagicBytes(byte[] b) {
        boolean jpeg = b.length > 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF;
        boolean png = b.length > 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G';
        return jpeg || png;
    }

    private BufferedImage decode(byte[] bytes) {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) throw invalid("UNREADABLE_IMAGE", "The image could not be decoded");
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true); // ignoreMetadata
                long pixels = (long) reader.getWidth(0) * reader.getHeight(0);
                if (pixels > MAX_SOURCE_PIXELS) throw invalid("IMAGE_TOO_LARGE", "Image dimensions are too large");
                return reader.read(0);
            } finally {
                reader.dispose();
            }
        } catch (IOException e) {
            throw invalid("UNREADABLE_IMAGE", "The image could not be decoded");
        }
    }

    private static BufferedImage downscaleToRgb(BufferedImage source) {
        int w = source.getWidth(), h = source.getHeight();
        double scale = Math.min(1.0, (double) MAX_DIMENSION / Math.max(w, h));
        int tw = Math.max(1, (int) Math.round(w * scale)), th = Math.max(1, (int) Math.round(h * scale));
        BufferedImage out = new BufferedImage(tw, th, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setColor(java.awt.Color.WHITE); // flatten PNG transparency
            g.fillRect(0, 0, tw, th);
            g.drawImage(source, 0, 0, tw, th, null);
        } finally {
            g.dispose();
        }
        return out;
    }

    private StoredImage store(BufferedImage image) {
        String filename = UUID.randomUUID() + ".jpg";
        Path target = hazardDir.resolve(filename);
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        try (ImageOutputStream out = ImageIO.createImageOutputStream(target.toFile())) {
            writer.setOutput(out);
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(JPEG_QUALITY);
            writer.write(null, new IIOImage(image, null, null), param); // null metadata = no EXIF
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_FAILED", "Could not store the image");
        } finally {
            writer.dispose();
        }
        try {
            return new StoredImage(URL_PREFIX + filename, image.getWidth(), image.getHeight(), Files.size(target));
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_FAILED", "Could not store the image");
        }
    }

    private static ApiException invalid(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message);
    }
}
