package com.saferoute.backend.moderation;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.confirmation.HazardAuditLog;
import com.saferoute.backend.confirmation.HazardAuditService;
import com.saferoute.backend.event.dto.HazardChange;
import com.saferoute.backend.event.producer.HazardEventProducer;
import com.saferoute.backend.hazard.Hazard;
import com.saferoute.backend.hazard.HazardRepository;
import com.saferoute.backend.hazard.dto.HazardResponse;
import com.saferoute.backend.moderation.dto.MunicipalResponseRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Assigning a hazard to a department and setting the city's priority, and marking it reviewed.
 * All are audited, and each change goes out as a hazard_updated frame so the portal and
 * commuters' apps show it at once. Any of them stops the archive clock.
 */
@Service
public class MunicipalResponseService {

    private final HazardRepository hazardRepository;
    private final HazardAuditService audit;
    private final HazardEventProducer eventProducer;
    private final MunicipalDepartments departments;

    public MunicipalResponseService(HazardRepository hazardRepository, HazardAuditService audit,
                                    HazardEventProducer eventProducer, MunicipalDepartments departments) {
        this.hazardRepository = hazardRepository;
        this.audit = audit;
        this.eventProducer = eventProducer;
        this.departments = departments;
    }

    @Transactional
    public HazardResponse update(UUID hazardId, UUID staffId, MunicipalResponseRequest request) {
        Hazard hazard = hazardRepository.findByIdForUpdate(hazardId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HAZARD_NOT_FOUND", "Hazard not found: " + hazardId));
        String department = departments.require(request.department());
        String note = request.note() != null && !request.note().isBlank() ? request.note().trim() : null;
        boolean changed = false;
        if (!Objects.equals(department, hazard.getAssignedDepartment())) {
            audit.record(hazardId, staffId, HazardAuditLog.Action.MUNICIPAL_ASSIGNED, "department",
                    hazard.getAssignedDepartment(), department, note);
            hazard.setAssignedDepartment(department);
            hazard.setAssignedAt(department != null ? Instant.now() : null);
            changed = true;
        }
        if (request.priority() != hazard.getMunicipalPriority()) {
            audit.record(hazardId, staffId, HazardAuditLog.Action.MUNICIPAL_PRIORITY, "priority",
                    hazard.getMunicipalPriority(), request.priority(), note);
            hazard.setMunicipalPriority(request.priority());
            changed = true;
        }
        if (!changed) return HazardResponse.from(hazard);
        hazard.markReviewed(staffId);
        hazard = hazardRepository.save(hazard);
        eventProducer.publishUpdated(hazard, HazardChange.MUNICIPAL_RESPONSE, staffId);
        return HazardResponse.from(hazard);
    }

    /** "Mark reviewed": the city has seen it. Also how an archived hazard comes back to the queue. */
    @Transactional
    public HazardResponse review(UUID hazardId, UUID staffId, String note) {
        Hazard hazard = hazardRepository.findByIdForUpdate(hazardId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HAZARD_NOT_FOUND", "Hazard not found: " + hazardId));
        if (!hazard.getStatus().isActive()) {
            throw new ApiException(HttpStatus.CONFLICT, "HAZARD_NOT_ACTIVE", "Hazard is " + hazard.getStatus());
        }
        boolean wasArchived = hazard.getArchivedAt() != null;
        audit.record(hazardId, staffId, HazardAuditLog.Action.STAFF_REVIEWED,
                note != null && !note.isBlank() ? note.trim() : (wasArchived ? "Restored from Archived" : null));
        hazard.markReviewed(staffId);
        hazard = hazardRepository.save(hazard);
        eventProducer.publishUpdated(hazard, HazardChange.REVIEWED, staffId);
        return HazardResponse.from(hazard);
    }
}
