package com.saferoute.backend.user;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * There is no self-service way to become a moderator. For the prototype, accounts whose email
 * is listed in {@code saferoute.bootstrap.moderator-emails} are promoted at startup and on
 * registration.
 */
@Component
public class ModeratorBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ModeratorBootstrap.class);

    private final UserRepository userRepository;
    private final Set<String> moderatorEmails;

    public ModeratorBootstrap(UserRepository userRepository,
                              @Value("${saferoute.bootstrap.moderator-emails:}") String moderatorEmails) {
        this.userRepository = userRepository;
        this.moderatorEmails = Arrays.stream(moderatorEmails.split(","))
                .map(String::trim).map(String::toLowerCase)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toSet());
    }

    public Role initialRoleFor(String email) {
        return moderatorEmails.contains(email.toLowerCase()) ? Role.MODERATOR : Role.USER;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        for (String email : moderatorEmails) {
            userRepository.findByEmailIgnoreCase(email).ifPresent(user -> {
                if (user.getRole() == Role.USER) {
                    user.setRole(Role.MODERATOR);
                    log.info("Promoted {} to MODERATOR (saferoute.bootstrap.moderator-emails)", email);
                }
            });
        }
    }
}
