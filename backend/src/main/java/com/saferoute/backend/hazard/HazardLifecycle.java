package com.saferoute.backend.hazard;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The crowdsourced confidence model. Status is always recomputed from the
 * current verify/dispute counts rather than incremented, so replaying an event can't drift it.
 *
 * <pre>
 * REPORTED --(verifies >= threshold)--> VERIFIED
 * REPORTED/VERIFIED --(disputes >= disputeThreshold && disputes >= verifies)--> DISPUTED
 * DISPUTED --(verifies overtake disputes)--> VERIFIED or REPORTED
 * RESOLVED / EXPIRED / REMOVED are terminal here; only moderators reopen.
 * </pre>
 */
@Component
public class HazardLifecycle {

    private final int verificationThreshold;
    private final int disputeThreshold;

    public HazardLifecycle(@Value("${saferoute.hazard.verification-threshold}") int verificationThreshold,
                           @Value("${saferoute.hazard.dispute-threshold}") int disputeThreshold) {
        this.verificationThreshold = verificationThreshold;
        this.disputeThreshold = disputeThreshold;
    }

    public HazardStatus evaluate(HazardStatus current, int verifies, int disputes) {
        if (!current.isActive()) return current;
        if (disputes >= disputeThreshold && disputes >= verifies) return HazardStatus.DISPUTED;
        if (verifies >= verificationThreshold) return HazardStatus.VERIFIED;
        return HazardStatus.REPORTED;
    }

    /** Null for inactive hazards — confidence only describes something currently on the map. */
    public static Confidence confidence(HazardStatus status, int verifies, int disputes) {
        if (!status.isActive()) return null;
        if (status == HazardStatus.DISPUTED) return Confidence.CONTESTED;
        if (verifies == 0 && disputes == 0) return Confidence.UNCONFIRMED;
        double support = (double) verifies / (verifies + disputes);
        if (status == HazardStatus.VERIFIED) {
            if (verifies >= 5 && support >= 0.8) return Confidence.HIGH;
            if (support >= 0.6) return Confidence.MEDIUM;
        }
        return Confidence.LOW;
    }
}
