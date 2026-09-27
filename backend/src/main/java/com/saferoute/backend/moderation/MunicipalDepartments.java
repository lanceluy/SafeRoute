package com.saferoute.backend.moderation;

import com.saferoute.backend.common.ApiException;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.http.HttpStatus;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The departments a hazard can be assigned to, code → display name, in display order. Set
 * {@code saferoute.municipal.departments} to change them; hazards keep the code they were given.
 */
@ConfigurationProperties(prefix = "saferoute.municipal")
public class MunicipalDepartments {

    public record Department(String code, String name) {
    }

    private Map<String, String> departments = new LinkedHashMap<>(Map.of());

    public MunicipalDepartments() {
        departments.put("ENGINEERING", "Engineering");
        departments.put("PUBLIC_SAFETY", "Public Safety");
        departments.put("BARANGAY_OFFICE", "Barangay Office");
        departments.put("TRAFFIC_MANAGEMENT", "Traffic Management");
        departments.put("DRAINAGE_FLOOD_CONTROL", "Drainage & Flood Control");
    }

    public List<Department> list() {
        return departments.entrySet().stream().map(e -> new Department(e.getKey(), e.getValue())).toList();
    }

    /** Null stays null (unassigned); anything else must be a configured code. */
    public String require(String code) {
        if (code == null || code.isBlank()) return null;
        String normalized = code.trim().toUpperCase();
        if (!departments.containsKey(normalized)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "UNKNOWN_DEPARTMENT",
                    "Unknown department; allowed: " + String.join(", ", departments.keySet()));
        }
        return normalized;
    }

    public boolean contains(String code) {
        return departments.containsKey(code);
    }

    public Map<String, String> getDepartments() { return departments; }
    public void setDepartments(Map<String, String> departments) { this.departments = new LinkedHashMap<>(departments); }
}
