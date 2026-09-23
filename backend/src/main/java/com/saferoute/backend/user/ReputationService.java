package com.saferoute.backend.user;

import com.saferoute.backend.confirmation.ConfirmationAction;
import com.saferoute.backend.confirmation.HazardConfirmation;
import com.saferoute.backend.confirmation.HazardConfirmationRepository;
import com.saferoute.backend.hazard.Hazard;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Makes users.reputation_score mean something (review §7). Reputation is one signal — it drives
 * the displayed trust tier and moderation-queue ordering — never the sole arbiter of truth.
 *
 * <ul>
 *   <li>Report becomes VERIFIED: reporter +5 (once per hazard)</li>
 *   <li>Verification of a hazard that becomes VERIFIED: +2 (once per confirmation)</li>
 *   <li>Dispute of a hazard a moderator removes as false: +2</li>
 *   <li>Report removed as false/spam: -5, escalating with each prior removal (capped at -20)</li>
 * </ul>
 */
@Service
public class ReputationService {

    static final int REPORT_VERIFIED = 5;
    static final int CORRECT_CONFIRMATION = 2;
    static final int REPORT_REMOVED_BASE = -5;
    static final int REPORT_REMOVED_CAP = -20;

    private static final Logger log = LoggerFactory.getLogger(ReputationService.class);

    private final UserRepository userRepository;
    private final ReputationEventRepository eventRepository;
    private final HazardConfirmationRepository confirmationRepository;

    public ReputationService(UserRepository userRepository,
                             ReputationEventRepository eventRepository,
                             HazardConfirmationRepository confirmationRepository) {
        this.userRepository = userRepository;
        this.eventRepository = eventRepository;
        this.confirmationRepository = confirmationRepository;
    }

    @Transactional
    public void onHazardVerified(Hazard hazard) {
        if (!hazard.isReporterRewarded()) {
            award(hazard.getReporterId(), hazard.getId(), REPORT_VERIFIED, ReputationEvent.Reason.REPORT_VERIFIED);
            hazard.setReporterRewarded(true);
        }
        for (HazardConfirmation c : confirmationRepository.findByHazardId(hazard.getId())) {
            if (c.getAction() == ConfirmationAction.VERIFY && !c.isReputationAwarded()) {
                award(c.getUserId(), hazard.getId(), CORRECT_CONFIRMATION, ReputationEvent.Reason.CORRECT_VERIFICATION);
                c.setReputationAwarded(true);
            }
        }
    }

    @Transactional
    public void onHazardRemovedAsFalse(Hazard hazard) {
        long priorRemovals = eventRepository.countByUserIdAndReason(hazard.getReporterId(), ReputationEvent.Reason.REPORT_REMOVED);
        int penalty = (int) Math.max(REPORT_REMOVED_CAP, REPORT_REMOVED_BASE * (priorRemovals + 1));
        award(hazard.getReporterId(), hazard.getId(), penalty, ReputationEvent.Reason.REPORT_REMOVED);
        for (HazardConfirmation c : confirmationRepository.findByHazardId(hazard.getId())) {
            if (c.getAction() == ConfirmationAction.DISPUTE && !c.isReputationAwarded()) {
                award(c.getUserId(), hazard.getId(), CORRECT_CONFIRMATION, ReputationEvent.Reason.CORRECT_DISPUTE);
                c.setReputationAwarded(true);
            }
        }
    }

    private void award(UUID userId, UUID hazardId, int delta, ReputationEvent.Reason reason) {
        userRepository.addReputation(userId, delta);
        eventRepository.save(ReputationEvent.builder()
                .userId(userId).hazardId(hazardId).delta(delta).reason(reason).build());
        log.debug("Reputation {} {} for user {} (hazard {})", delta >= 0 ? "+" + delta : delta, reason, userId, hazardId);
    }
}
