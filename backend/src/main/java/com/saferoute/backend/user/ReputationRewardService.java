package com.saferoute.backend.user;

import com.saferoute.backend.hazard.Hazard;
import com.saferoute.backend.hazard.HazardRepository;
import com.saferoute.backend.hazard.HazardStatus;
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
 * Pays reputation for verified hazards once they have stood without being removed
 * ({@code saferoute.trust.reputation-delay}). Paying on the spot would let colluding accounts farm
 * reputation from fake hazards before a moderator can look at them.
 */
@Service
public class ReputationRewardService {

    private static final Logger log = LoggerFactory.getLogger(ReputationRewardService.class);
    private static final int BATCH_SIZE = 200;

    private final HazardRepository hazardRepository;
    private final ReputationService reputationService;
    private final TransactionTemplate transactionTemplate;

    public ReputationRewardService(HazardRepository hazardRepository, ReputationService reputationService,
                                   TransactionTemplate transactionTemplate) {
        this.hazardRepository = hazardRepository;
        this.reputationService = reputationService;
        this.transactionTemplate = transactionTemplate;
    }

    @Scheduled(fixedDelayString = "${saferoute.trust.reward-check-interval:PT5M}", initialDelayString = "PT1M")
    public void payDue() {
        payDueRewards(Instant.now());
    }

    /** @return how many hazards had their rewards paid. Public so tests can move the clock. */
    public int payDueRewards(Instant now) {
        List<UUID> ids = hazardRepository.findRewardDueIds(now, BATCH_SIZE);
        int paid = 0;
        for (UUID id : ids) {
            try {
                if (Boolean.TRUE.equals(transactionTemplate.execute(status -> payOne(id)))) paid++;
            } catch (ObjectOptimisticLockingFailureException e) {
                log.debug("Hazard {} changed while paying rewards; will retry next run", id);
            }
        }
        if (paid > 0) log.info("Paid reputation for {} hazard(s) that stood unchallenged", paid);
        return paid;
    }

    private boolean payOne(UUID id) {
        Hazard hazard = hazardRepository.findByIdForUpdate(id).orElse(null);
        if (hazard == null || hazard.isReporterRewarded()) return false;
        HazardStatus status = hazard.getStatus();
        // Still VERIFIED, or closed in a way that is not a false-report removal.
        if (status != HazardStatus.VERIFIED && status != HazardStatus.RESOLVED && status != HazardStatus.EXPIRED) return false;
        reputationService.payRewards(hazard);
        hazardRepository.save(hazard);
        return true;
    }
}
