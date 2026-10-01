package com.saferoute.backend.hazard;

import com.saferoute.backend.confirmation.HazardAuditLog;
import com.saferoute.backend.confirmation.HazardAuditService;
import com.saferoute.backend.event.dto.HazardChange;
import com.saferoute.backend.event.producer.HazardEventProducer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Archives reports the city hasn't acted on within {@code saferoute.hazard.archive-after} (a week).
 * Archiving takes a hazard out of the portal's working queues into its Archived tab; it stays
 * active, so commuters still see and are warned about it. Any staff action (Mark reviewed, a city
 * response, reopen, remove) stops the clock and brings it back. Same shape as {@link HazardExpiryService}.
 */
@Service
public class HazardArchiveService {

    private static final Logger log = LoggerFactory.getLogger(HazardArchiveService.class);
    private static final int BATCH_SIZE = 200;

    private final HazardRepository hazardRepository;
    private final HazardAuditService audit;
    private final HazardEventProducer eventProducer;
    private final TransactionTemplate transactionTemplate;
    private final Duration archiveAfter;

    public HazardArchiveService(HazardRepository hazardRepository, HazardAuditService audit,
                                HazardEventProducer eventProducer, TransactionTemplate transactionTemplate,
                                @Value("${saferoute.hazard.archive-after:P7D}") Duration archiveAfter) {
        this.hazardRepository = hazardRepository;
        this.audit = audit;
        this.eventProducer = eventProducer;
        this.transactionTemplate = transactionTemplate;
        this.archiveAfter = archiveAfter;
    }

    public Duration archiveAfter() {
        return archiveAfter;
    }

    @Scheduled(fixedDelayString = "${saferoute.hazard.archive-check-interval:PT10M}", initialDelayString = "PT45S")
    public void archiveUnreviewed() {
        List<UUID> ids = hazardRepository.findUnreviewedIds(Instant.now().minus(archiveAfter), BATCH_SIZE);
        int archived = 0;
        for (UUID id : ids) {
            try {
                if (Boolean.TRUE.equals(transactionTemplate.execute(status -> archive(id)))) archived++;
            } catch (ObjectOptimisticLockingFailureException e) {
                log.debug("Hazard {} changed while archiving; will re-check next run", id);
            }
        }
        if (archived > 0) log.info("Archived {} unreviewed hazard(s)", archived);
    }

    /** @return true if the hazard was archived. Re-checks under the transaction in case staff just acted on it. */
    boolean archive(UUID id) {
        Hazard hazard = hazardRepository.findById(id).orElse(null);
        if (hazard == null || !hazard.getStatus().isActive() || hazard.getReviewedAt() != null
                || hazard.getArchivedAt() != null || hazard.getCreatedAt().isAfter(Instant.now().minus(archiveAfter))) {
            return false;
        }
        hazard.setArchivedAt(Instant.now());
        audit.record(id, null, HazardAuditLog.Action.ARCHIVED,
                "No staff review within " + archiveAfter.toDays() + " days");
        hazardRepository.save(hazard);
        eventProducer.publishUpdated(hazard, HazardChange.ARCHIVED, null);
        return true;
    }
}
