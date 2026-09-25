package com.saferoute.backend.hazard;

import com.saferoute.backend.confirmation.HazardAuditService;
import com.saferoute.backend.event.dto.HazardChange;
import com.saferoute.backend.event.producer.HazardEventProducer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Moves stale hazards to EXPIRED. A plain @Scheduled task is enough for a single
 * instance prototype; each hazard is expired in its own transaction so one conflict (someone
 * confirmed it at the same moment) doesn't block the rest.
 */
@Service
public class HazardExpiryService {

    private static final Logger log = LoggerFactory.getLogger(HazardExpiryService.class);
    private static final int BATCH_SIZE = 200;

    private final HazardRepository hazardRepository;
    private final HazardAuditService audit;
    private final HazardEventProducer eventProducer;
    private final TransactionTemplate transactionTemplate;

    public HazardExpiryService(HazardRepository hazardRepository, HazardAuditService audit,
                               HazardEventProducer eventProducer, TransactionTemplate transactionTemplate) {
        this.hazardRepository = hazardRepository;
        this.audit = audit;
        this.eventProducer = eventProducer;
        this.transactionTemplate = transactionTemplate;
    }

    @Scheduled(fixedDelayString = "${saferoute.hazard.expiry-check-interval}", initialDelayString = "PT30S")
    public void expireStaleHazards() {
        List<UUID> ids = hazardRepository.findExpiredIds(Instant.now(), BATCH_SIZE);
        int expired = 0;
        for (UUID id : ids) {
            try {
                if (Boolean.TRUE.equals(transactionTemplate.execute(status -> expire(id)))) expired++;
            } catch (ObjectOptimisticLockingFailureException e) {
                log.debug("Hazard {} changed while expiring; will re-check next run", id);
            }
        }
        if (expired > 0) log.info("Expired {} stale hazard(s)", expired);
    }

    /** @return true if the hazard was expired. Re-checks under the transaction in case it was just reconfirmed. */
    boolean expire(UUID id) {
        Hazard hazard = hazardRepository.findById(id).orElse(null);
        if (hazard == null || !hazard.getStatus().isActive() || hazard.getExpiresAt().isAfter(Instant.now())) {
            return false;
        }
        HazardStatus old = hazard.getStatus();
        hazard.setStatus(HazardStatus.EXPIRED);
        audit.statusChanged(id, null, old, HazardStatus.EXPIRED,
                "No confirmation since " + hazard.getLastConfirmedAt());
        hazardRepository.save(hazard);
        eventProducer.publishUpdated(hazard, HazardChange.EXPIRED, null);
        return true;
    }
}
