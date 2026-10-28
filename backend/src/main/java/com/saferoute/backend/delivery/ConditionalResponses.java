package com.saferoute.backend.delivery;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.DigestUtils;

import java.nio.charset.StandardCharsets;

/**
 * Conditional GET for the polling endpoints. The ETag is a hash of the serialized body, so it is
 * identical on every backend instance (no shared version counter needed) and a client that polls an
 * unchanged area gets a body-less 304. The query still runs; this saves bandwidth and client work,
 * not database load. {@code Cache-Control: no-cache} forces revalidation every time.
 */
public final class ConditionalResponses {

    private ConditionalResponses() {
    }

    public static <T> ResponseEntity<T> respond(String ifNoneMatch, T body, ObjectMapper mapper, HttpHeaders extra) {
        String etag = etagOf(body, mapper);
        if (matches(ifNoneMatch, etag)) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(etag).headers(extra).cacheControl(CacheControl.noCache()).build();
        }
        return ResponseEntity.ok().eTag(etag).headers(extra).cacheControl(CacheControl.noCache()).body(body);
    }

    static String etagOf(Object body, ObjectMapper mapper) {
        try {
            return "\"" + DigestUtils.md5DigestAsHex(mapper.writeValueAsString(body).getBytes(StandardCharsets.UTF_8)) + "\"";
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not serialize response for ETag", e);
        }
    }

    /** RFC 9110 weak comparison of an If-None-Match list against one ETag. */
    static boolean matches(String ifNoneMatch, String etag) {
        if (ifNoneMatch == null || ifNoneMatch.isBlank()) return false;
        if (ifNoneMatch.trim().equals("*")) return true;
        for (String candidate : ifNoneMatch.split(",")) {
            String c = candidate.trim();
            if (c.startsWith("W/")) c = c.substring(2);
            if (c.equals(etag)) return true;
        }
        return false;
    }
}
