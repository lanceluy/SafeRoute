package com.saferoute.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.saferoute.backend.event.consumer.HazardProcessingConsumer;
import com.saferoute.backend.ratelimit.RateLimitPolicy;
import com.saferoute.backend.ratelimit.RateLimitProperties;
import com.saferoute.backend.support.IntegrationTestBase;
import com.saferoute.backend.user.AccountStatusService;
import com.saferoute.backend.user.ReputationRewardService;
import com.saferoute.backend.user.ReputationService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * The defences from docs/ADVERSARIAL_RESULTS.md, switched on: suspension after repeated false reports,
 * tighter limits for new accounts, reputation paid only after a hazard has stood, and counting each
 * registration source once per hazard. The rest of the suite runs with these neutral (application-test.yml); this class
 * switches them on for the shared context and restores them, because a second Spring context would split the Kafka
 * consumer groups (see AuthIntegrationTest).
 */
class TrustHardeningIntegrationTest extends IntegrationTestBase {

    @Autowired ReputationRewardService rewards;
    @Autowired ReputationService reputationService;
    @Autowired AccountStatusService accountStatus;
    @Autowired HazardProcessingConsumer processingConsumer;
    @Autowired RateLimitProperties rateLimits;

    private Object[] saved;

    @BeforeEach
    void switchDefencesOn() {
        saved = new Object[]{
                ReflectionTestUtils.getField(reputationService, "rewardDelay"),
                ReflectionTestUtils.getField(accountStatus, "suspendAfterRemovals"),
                ReflectionTestUtils.getField(processingConsumer, "distinctSources"),
                rateLimits.getLimits().get(RateLimitPolicy.HAZARD_REPORT_NEW_ACCOUNT),
                rateLimits.getLimits().get(RateLimitPolicy.CONFIRMATION_NEW_ACCOUNT)};
        ReflectionTestUtils.setField(reputationService, "rewardDelay", Duration.ofHours(24));
        ReflectionTestUtils.setField(accountStatus, "suspendAfterRemovals", 2);
        ReflectionTestUtils.setField(processingConsumer, "distinctSources", true);
        rateLimits.getLimits().put(RateLimitPolicy.HAZARD_REPORT_NEW_ACCOUNT, new RateLimitProperties.Limit(2, Duration.ofHours(1)));
        rateLimits.getLimits().put(RateLimitPolicy.CONFIRMATION_NEW_ACCOUNT, new RateLimitProperties.Limit(10, Duration.ofHours(1)));
    }

    @AfterEach
    void restore() {
        ReflectionTestUtils.setField(reputationService, "rewardDelay", saved[0]);
        ReflectionTestUtils.setField(accountStatus, "suspendAfterRemovals", saved[1]);
        ReflectionTestUtils.setField(processingConsumer, "distinctSources", saved[2]);
        rateLimits.getLimits().put(RateLimitPolicy.HAZARD_REPORT_NEW_ACCOUNT, (RateLimitProperties.Limit) saved[3]);
        rateLimits.getLimits().put(RateLimitPolicy.CONFIRMATION_NEW_ACCOUNT, (RateLimitProperties.Limit) saved[4]);
    }

    private int reputation(TestUser user) {
        return jdbc.queryForObject("SELECT reputation_score FROM users WHERE id = ?", Integer.class, user.id());
    }

    private void remove(TestUser moderator, UUID hazardId) throws Exception {
        expectStatus(mvc.perform(delete("/api/hazards/" + hazardId).param("reason", "Spam").with(bearer(moderator))).andReturn(), 200);
    }

    private void verifyBy(UUID hazardId, TestUser viewer, TestUser... confirmers) throws Exception {
        for (TestUser c : confirmers) confirm(c, hazardId, "VERIFY");
        awaitHazard(viewer, hazardId, h -> "VERIFIED".equals(h.get("status").asText()));
    }

    @Test
    void newAccountsAreCappedButStaffAreNot() throws Exception {
        TestUser rookie = registerUser();
        submit(rookie, "FLOODING", freshLocation());
        submit(rookie, "FLOODING", freshLocation());
        expectStatus(mvc.perform(post("/api/hazard-submissions").with(bearer(rookie))
                .contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("type", "FLOODING", "latitude", freshLocation().lat(), "longitude", freshLocation().lon()))))
                .andReturn(), 429);

        TestUser mod = registerModerator();
        for (int i = 0; i < 3; i++) submit(mod, "FLOODING", freshLocation());
    }

    @Test
    void repeatedRemovalsSuspendAnAccountUntilAModeratorReinstatesIt() throws Exception {
        TestUser spammer = registerUser();
        TestUser other = registerUser();
        TestUser mod = registerModerator();
        UUID bystander = reportAndAwaitHazard(other, "OPEN_MANHOLE", freshLocation());

        remove(mod, reportAndAwaitHazard(spammer, "FLOODING", freshLocation()));
        assertThat(jdbc.queryForObject("SELECT suspended_at FROM users WHERE id = ?", Object.class, spammer.id())).isNull();
        remove(mod, reportAndAwaitHazard(spammer, "FLOODING", freshLocation()));
        assertThat(jdbc.queryForObject("SELECT suspended_at FROM users WHERE id = ?", Object.class, spammer.id())).isNotNull();

        JsonNode blocked = json(mvc.perform(post("/api/hazard-submissions").with(bearer(spammer))
                .contentType(MediaType.APPLICATION_JSON)
                .content(toJson(Map.of("type", "FLOODING", "latitude", freshLocation().lat(), "longitude", freshLocation().lon()))))
                .andReturn(), 403);
        assertThat(blocked.toString()).contains("ACCOUNT_SUSPENDED");
        expectStatus(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .put("/api/hazards/" + bystander + "/confirmation").with(bearer(spammer))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("action", "VERIFY")))).andReturn(), 403);

        // Staff cannot be suspended.
        expectStatus(mvc.perform(post("/api/moderation/users/" + mod.id() + "/suspend").with(bearer(mod))
                .contentType(MediaType.APPLICATION_JSON).content(toJson(Map.of("reason", "test")))).andReturn(), 409);

        expectStatus(mvc.perform(post("/api/moderation/users/" + spammer.id() + "/unsuspend").with(bearer(mod))).andReturn(), 204);
        confirm(spammer, bystander, "VERIFY");
    }

    @Test
    void reputationIsPaidOnlyAfterTheHazardHasStood() throws Exception {
        TestUser reporter = registerUser();
        TestUser first = registerUser();
        TestUser second = registerUser();
        UUID hazardId = reportAndAwaitHazard(reporter, "FLOODING", freshLocation());
        verifyBy(hazardId, reporter, first, second);

        assertThat(reputation(reporter)).isZero();
        rewards.payDueRewards(Instant.now());
        assertThat(reputation(reporter)).as("not due yet").isZero();

        rewards.payDueRewards(Instant.now().plus(Duration.ofHours(25)));
        assertThat(reputation(reporter)).isEqualTo(5);
        assertThat(reputation(first)).isEqualTo(2);
        assertThat(reputation(second)).isEqualTo(2);
    }

    @Test
    void aHazardRemovedBeforeTheRewardIsDueEarnsNothing() throws Exception {
        TestUser reporter = registerUser();
        TestUser first = registerUser();
        TestUser second = registerUser();
        TestUser mod = registerModerator();
        UUID hazardId = reportAndAwaitHazard(reporter, "FLOODING", freshLocation());
        verifyBy(hazardId, reporter, first, second);

        remove(mod, hazardId);
        rewards.payDueRewards(Instant.now().plus(Duration.ofHours(25)));

        assertThat(reputation(reporter)).isEqualTo(-5);
        assertThat(reputation(first)).isZero();
        assertThat(reputation(second)).isZero();
    }

    @Test
    void confirmationsFromTheReportersOwnSourceDoNotCount() throws Exception {
        String home = "198.51.100.7";
        TestUser reporter = registerUserFrom(home);
        TestUser sockOne = registerUserFrom(home);
        TestUser sockTwo = registerUserFrom(home);
        UUID hazardId = reportAndAwaitHazard(reporter, "FLOODING", freshLocation());

        confirm(sockOne, hazardId, "VERIFY");
        confirm(sockTwo, hazardId, "VERIFY");
        awaitJson(get("/api/hazards/" + hazardId + "/history").with(bearer(reporter)),
                n -> n.findValuesAsText("action").stream().filter("CONFIRMATION_CHANGED"::equals).count() == 2);
        JsonNode stuck = hazardDetail(reporter, hazardId).get("hazard");
        assertThat(stuck.get("status").asText()).isEqualTo("REPORTED");
        assertThat(stuck.get("confirmationCount").asInt()).isZero();

        TestUser neighbourOne = registerUser();
        TestUser neighbourTwo = registerUser();
        confirm(neighbourOne, hazardId, "VERIFY");
        confirm(neighbourTwo, hazardId, "VERIFY");
        JsonNode verified = awaitHazard(reporter, hazardId, h -> "VERIFIED".equals(h.get("status").asText()));
        assertThat(verified.get("confirmationCount").asInt()).isEqualTo(2);
    }
}
