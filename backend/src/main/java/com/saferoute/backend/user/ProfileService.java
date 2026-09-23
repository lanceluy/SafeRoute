package com.saferoute.backend.user;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.confirmation.ConfirmationAction;
import com.saferoute.backend.confirmation.HazardConfirmationRepository;
import com.saferoute.backend.hazard.Hazard;
import com.saferoute.backend.hazard.HazardRepository;
import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.submission.HazardSubmissionRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/** Closes the contribution feedback loop (review §34) — deliberately not a social profile. */
@Service
public class ProfileService {

    public record Stats(long reportsSubmitted, long reportsVerified, long communityConfirmations, long disputesFiled) {
    }

    public record Activity(ReputationEvent.Reason reason, int delta, UUID hazardId, HazardType hazardType, Instant at) {
    }

    public record ProfileResponse(UUID id, String email, String displayName, Role role, int reputationScore,
                                  TrustLevel trustLevel, Integer pointsToNextLevel, Stats stats, List<Activity> recentActivity) {
    }

    private final UserRepository userRepository;
    private final HazardSubmissionRepository submissionRepository;
    private final HazardRepository hazardRepository;
    private final HazardConfirmationRepository confirmationRepository;
    private final ReputationEventRepository reputationEventRepository;

    public ProfileService(UserRepository userRepository, HazardSubmissionRepository submissionRepository,
                          HazardRepository hazardRepository, HazardConfirmationRepository confirmationRepository,
                          ReputationEventRepository reputationEventRepository) {
        this.userRepository = userRepository;
        this.submissionRepository = submissionRepository;
        this.hazardRepository = hazardRepository;
        this.confirmationRepository = confirmationRepository;
        this.reputationEventRepository = reputationEventRepository;
    }

    public ProfileResponse profile(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Account no longer exists"));
        Stats stats = new Stats(
                submissionRepository.countByReporterId(userId),
                hazardRepository.countByReporterIdAndReporterRewardedTrue(userId),
                confirmationRepository.countByUserIdAndAction(userId, ConfirmationAction.VERIFY),
                confirmationRepository.countByUserIdAndAction(userId, ConfirmationAction.DISPUTE));

        List<ReputationEvent> events = reputationEventRepository.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(0, 10));
        Map<UUID, HazardType> types = hazardRepository.findByIdIn(
                        events.stream().map(ReputationEvent::getHazardId).filter(Objects::nonNull).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(Hazard::getId, Hazard::getType, (a, b) -> a));
        List<Activity> activity = events.stream()
                .map(e -> new Activity(e.getReason(), e.getDelta(), e.getHazardId(), types.get(e.getHazardId()), e.getCreatedAt()))
                .toList();

        int score = user.getReputationScore();
        Integer toNext = switch (user.trustLevel()) {
            case NEW_REPORTER -> TrustLevel.REGULAR_THRESHOLD - score;
            case REGULAR_REPORTER -> TrustLevel.TRUSTED_THRESHOLD - score;
            case TRUSTED_REPORTER -> null;
        };
        return new ProfileResponse(user.getId(), user.getEmail(), user.getDisplayName(), user.getRole(), score,
                user.trustLevel(), toNext, stats, activity);
    }
}
