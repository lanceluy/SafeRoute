package com.saferoute.backend.coverage;

import com.saferoute.backend.common.ApiException;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.http.HttpStatus;

/**
 * The pilot service area. Defaults to a Metro Manila bounding box; set
 * {@code saferoute.coverage.enabled=false} to accept reports anywhere (e.g. for a Simulator
 * sitting at Apple Park).
 */
@ConfigurationProperties(prefix = "saferoute.coverage")
public class CoverageArea {

    private boolean enabled = true;
    private String name = "Metro Manila pilot area";
    private double minLat = 14.35;
    private double maxLat = 14.80;
    private double minLon = 120.90;
    private double maxLon = 121.15;

    public void requireCovered(double lat, double lon) {
        if (!Double.isFinite(lat) || !Double.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_COORDINATES", "Coordinates are out of range");
        }
        if (enabled && !contains(lat, lon)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "OUTSIDE_COVERAGE_AREA",
                    "SafeRoute is currently available in the " + name + " only.");
        }
    }

    public boolean contains(double lat, double lon) {
        return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
    }

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public double getMinLat() { return minLat; }
    public void setMinLat(double minLat) { this.minLat = minLat; }
    public double getMaxLat() { return maxLat; }
    public void setMaxLat(double maxLat) { this.maxLat = maxLat; }
    public double getMinLon() { return minLon; }
    public void setMinLon(double minLon) { this.minLon = minLon; }
    public double getMaxLon() { return maxLon; }
    public void setMaxLon(double maxLon) { this.maxLon = maxLon; }
}
