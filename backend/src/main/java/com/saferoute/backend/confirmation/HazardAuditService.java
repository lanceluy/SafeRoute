package com.saferoute.backend.confirmation;

import com.saferoute.backend.common.Correlation;
import com.saferoute.backend.hazard.HazardStatus;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

/**
 * Single entry point for recording hazard changes. Status changes are written to both the
 * legacy hazard_status_history table and the audit log.
 */
@Service
public class HazardAuditService {

    private final HazardAuditLogRepository auditRepository;
    private final HazardStatusHistoryRepository historyRepository;

    public HazardAuditService(HazardAuditLogRepository auditRepository,
                              HazardStatusHistoryRepository historyRepository) {
        this.auditRepository = auditRepository;
        this.historyRepository = historyRepository;
    }

    public void record(UUID hazardId, UUID actorId, HazardAuditLog.Action action, String note) {
        record(hazardId, actorId, action, null, null, null, note);
    }

    public void record(UUID hazardId, UUID actorId, HazardAuditLog.Action action,
                       String field, Object oldValue, Object newValue, String note) {
        auditRepository.save(HazardAuditLog.builder()
                .hazardId(hazardId)
                .actorId(actorId)
                .action(action)
                .fieldName(field)
                .oldValue(oldValue != null ? oldValue.toString() : null)
                .newValue(newValue != null ? newValue.toString() : null)
                .note(note)
                .correlationId(Correlation.currentId())
                .build());
    }

    public void statusChanged(UUID hazardId, UUID actorId, HazardStatus oldStatus, HazardStatus newStatus, String note) {
        if (Objects.equals(oldStatus, newStatus)) return;
        historyRepository.save(HazardStatusHistory.builder()
                .hazardId(hazardId)
                .oldStatus(oldStatus)
                .newStatus(newStatus)
                .changedBy(actorId)
                .note(note)
                .build());
        record(hazardId, actorId, HazardAuditLog.Action.STATUS_CHANGED, "status", oldStatus, newStatus, note);
    }
}
