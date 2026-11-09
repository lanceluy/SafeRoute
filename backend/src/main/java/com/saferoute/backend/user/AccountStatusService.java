package com.saferoute.backend.user;

import com.saferoute.backend.auth.AuthenticatedUser;
import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.ratelimit.RateLimitPolicy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Who may contribute, and how fast. Two of the defences from docs/ADVERSARIAL_RESULTS.md live here:
 * suspension after repeated false reports, and tighter rate limits for accounts that have not yet
 * earned the Regular tier. Staff are never suspended or capped.
 */
@Service
public class AccountStatusService {

    private static final Logger log = LoggerFactory.getLogger(AccountStatusService.class);

    private final UserRepository userRepository;
    private int suspendAfterRemovals; // not final: TrustHardeningIntegrationTest switches it on the shared context

    public AccountStatusService(UserRepository userRepository,
                                @Value("${saferoute.trust.suspend-after-removals:3}") int suspendAfterRemovals) {
        this.userRepository = userRepository;
        this.suspendAfterRemovals = suspendAfterRemovals;
    }

    public boolean isSuspended(UUID userId) {
        return userRepository.findById(userId).map(User::isSuspended).orElse(false);
    }

    /** Throws 403 ACCOUNT_SUSPENDED. Reading the map stays open; only contributing is blocked. */
    public void requireActive(UUID userId) {
        if (isSuspended(userId)) throw suspended();
    }

    /** Rate-limit bucket for a hazard report: stricter for new accounts. Also rejects suspended accounts. */
    public RateLimitPolicy admitReport(AuthenticatedUser principal) {
        return admit(principal, RateLimitPolicy.HAZARD_REPORT, RateLimitPolicy.HAZARD_REPORT_NEW_ACCOUNT);
    }

    /** Rate-limit bucket for a verify/dispute: stricter for new accounts. Also rejects suspended accounts. */
    public RateLimitPolicy admitConfirmation(AuthenticatedUser principal) {
        return admit(principal, RateLimitPolicy.CONFIRMATION, RateLimitPolicy.CONFIRMATION_NEW_ACCOUNT);
    }

    private RateLimitPolicy admit(AuthenticatedUser principal, RateLimitPolicy standard, RateLimitPolicy newAccount) {
        if (principal.canModerate()) return standard;
        User user = userRepository.findById(principal.id()).orElseThrow(
                () -> new ApiException(HttpStatus.UNAUTHORIZED, "Account no longer exists"));
        if (user.isSuspended()) throw suspended();
        return user.getReputationScore() < TrustLevel.REGULAR_THRESHOLD ? newAccount : standard;
    }

    /** Called when one of the user's reports was removed as false; {@code totalRemovals} includes this one. */
    @Transactional
    public void onReportRemoved(UUID reporterId, long totalRemovals) {
        if (suspendAfterRemovals <= 0 || totalRemovals < suspendAfterRemovals) return;
        userRepository.findById(reporterId).ifPresent(user -> {
            if (user.getRole() != Role.USER || user.isSuspended()) return;
            user.setSuspendedAt(Instant.now());
            user.setSuspensionReason(totalRemovals + " reports removed as false");
            userRepository.save(user);
            log.warn("Suspended user {} after {} removed reports", reporterId, totalRemovals);
        });
    }

    @Transactional
    public void suspend(UUID userId, String reason, UUID moderatorId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "No such user"));
        if (user.getRole() != Role.USER) {
            throw new ApiException(HttpStatus.CONFLICT, "STAFF_ACCOUNT", "Staff accounts cannot be suspended");
        }
        if (user.isSuspended()) return;
        user.setSuspendedAt(Instant.now());
        user.setSuspensionReason(reason);
        userRepository.save(user);
        log.warn("User {} suspended by {}: {}", userId, moderatorId, reason);
    }

    @Transactional
    public void unsuspend(UUID userId, UUID moderatorId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "No such user"));
        if (!user.isSuspended()) return;
        user.setSuspendedAt(null);
        user.setSuspensionReason(null);
        userRepository.save(user);
        log.info("User {} reinstated by {}", userId, moderatorId);
    }

    private static ApiException suspended() {
        return new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_SUSPENDED",
                "Your account is suspended because reports from it were removed as false. Contact the city moderators.");
    }
}
