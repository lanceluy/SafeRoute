package com.saferoute.backend.user;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Moderator provisioning. Public registration never grants a privileged role by itself:
 * <ul>
 *   <li>{@code saferoute.bootstrap.moderator-user-ids} — the controlled path. An operator adds the
 *       account id after the person registered and was verified out of band; it is promoted at
 *       startup.</li>
 *   <li>{@code saferoute.bootstrap.moderator-emails} — a convenience for local development and
 *       benchmarks. Email ownership is not verified, so anyone could register an allowlisted
 *       address first; it is honoured only when {@code trust-unverified-emails} is true.</li>
 * </ul>
 * Every grant is recorded in {@code role_grants}.
 */
@Component
public class ModeratorBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ModeratorBootstrap.class);

    private final UserRepository userRepository;
    private final JdbcTemplate jdbc;
    private final Set<UUID> moderatorUserIds;
    private final Set<String> moderatorEmails;
    private final boolean trustUnverifiedEmails;

    public ModeratorBootstrap(UserRepository userRepository,
                              JdbcTemplate jdbc,
                              @Value("${saferoute.bootstrap.moderator-user-ids:}") String moderatorUserIds,
                              @Value("${saferoute.bootstrap.moderator-emails:}") String moderatorEmails,
                              @Value("${saferoute.bootstrap.trust-unverified-emails:false}") boolean trustUnverifiedEmails) {
        this.userRepository = userRepository;
        this.jdbc = jdbc;
        this.moderatorUserIds = csv(moderatorUserIds).stream().map(UUID::fromString).collect(Collectors.toSet());
        this.moderatorEmails = csv(moderatorEmails).stream().map(String::toLowerCase).collect(Collectors.toSet());
        this.trustUnverifiedEmails = trustUnverifiedEmails;
        if (!this.moderatorEmails.isEmpty() && !trustUnverifiedEmails) {
            log.warn("saferoute.bootstrap.moderator-emails is set but ignored: email ownership is not verified. "
                    + "Use saferoute.bootstrap.moderator-user-ids.");
        }
    }

    /** Called after a new account is saved. Promotes it only under the dev-only email allowlist. */
    public void onRegistered(User user) {
        if (trustUnverifiedEmails && moderatorEmails.contains(user.getEmail().toLowerCase())) {
            promote(user, "Registered with an allowlisted email (trust-unverified-emails, development only)");
        }
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        for (UUID id : moderatorUserIds) {
            userRepository.findById(id).ifPresentOrElse(
                    user -> promote(user, "saferoute.bootstrap.moderator-user-ids"),
                    () -> log.warn("saferoute.bootstrap.moderator-user-ids: no account {}", id));
        }
        if (trustUnverifiedEmails) {
            for (String email : moderatorEmails) {
                userRepository.findByEmailIgnoreCase(email).ifPresent(user ->
                        promote(user, "Allowlisted email at startup (trust-unverified-emails, development only)"));
            }
        }
    }

    private void promote(User user, String reason) {
        if (user.getRole() != Role.USER) return;
        Role old = user.getRole();
        user.setRole(Role.MODERATOR);
        userRepository.save(user);
        jdbc.update("INSERT INTO role_grants (user_id, old_role, new_role, granted_by, reason) VALUES (?, ?, ?, NULL, ?)",
                user.getId(), old.name(), Role.MODERATOR.name(), reason);
        log.warn("Promoted {} ({}) to MODERATOR: {}", user.getEmail(), user.getId(), reason);
    }

    private static Set<String> csv(String value) {
        return Arrays.stream(value.split(",")).map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
    }
}
