package com.saferoute.backend.hazard.dto;

import com.saferoute.backend.confirmation.ConfirmationAction;
import com.saferoute.backend.confirmation.ResolutionAction;
import com.saferoute.backend.user.TrustLevel;

/**
 * Everything the Hazard Detail screen needs in one call (review §16). The reporter is described
 * by trust tier only — no name or id beyond what HazardResponse already carries.
 */
public record HazardDetailResponse(
        HazardResponse hazard,
        TrustLevel reporterTrustLevel,
        Viewer viewer,
        Community community,
        /** In the last 20% of the expiry window: the client should ask "Is this still here?". */
        boolean expiringSoon
) {
    public record Viewer(boolean isReporter, ConfirmationAction confirmation, ResolutionAction resolutionVote,
                         boolean canEdit, boolean canModerate) {
    }

    public record Community(int confirmations, int disputes, long noLongerPresentVotes, long stillPresentVotes,
                            int resolutionThreshold) {
    }
}
