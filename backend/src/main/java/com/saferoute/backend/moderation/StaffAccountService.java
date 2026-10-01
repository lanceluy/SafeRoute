package com.saferoute.backend.moderation;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.moderation.dto.StaffAccountRequest;
import com.saferoute.backend.moderation.dto.StaffMember;
import com.saferoute.backend.user.Role;
import com.saferoute.backend.user.User;
import com.saferoute.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;

/**
 * More LGU accounts for the same city: an official creates them for colleagues. Public
 * registration still never grants a staff role; every grant here is recorded in {@code role_grants}
 * with the official who made it.
 */
@Service
public class StaffAccountService {

    private static final Logger log = LoggerFactory.getLogger(StaffAccountService.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JdbcTemplate jdbc;

    public StaffAccountService(UserRepository userRepository, PasswordEncoder passwordEncoder, JdbcTemplate jdbc) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jdbc = jdbc;
    }

    /** Staff accounts, newest first, with the latest grant that gave each one access. */
    @Transactional(readOnly = true)
    public List<StaffMember> list() {
        return jdbc.query("""
                SELECT u.id, u.email, u.display_name, u.role, u.created_at, g.created_at AS granted_at, gb.display_name AS granted_by
                FROM users u
                LEFT JOIN LATERAL (SELECT * FROM role_grants r WHERE r.user_id = u.id AND r.new_role = u.role
                                   ORDER BY r.created_at DESC LIMIT 1) g ON TRUE
                LEFT JOIN users gb ON gb.id = g.granted_by
                WHERE u.role IN ('MODERATOR', 'MUNICIPAL_OFFICIAL')
                ORDER BY u.created_at DESC
                """, (rs, i) -> new StaffMember(rs.getObject("id", UUID.class), rs.getString("email"),
                rs.getString("display_name"), rs.getString("role"), rs.getTimestamp("created_at").toInstant(),
                rs.getString("granted_by"), instant(rs.getTimestamp("granted_at"))));
    }

    @Transactional
    public StaffMember create(UUID officialId, StaffAccountRequest request) {
        String email = request.email().trim().toLowerCase();
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "An account with this email already exists");
        }
        User user = userRepository.saveAndFlush(User.builder()
                .email(email)
                .passwordHash(passwordEncoder.encode(request.password()))
                .displayName(request.displayName().trim())
                .role(Role.MUNICIPAL_OFFICIAL)
                .build());
        jdbc.update("INSERT INTO role_grants (user_id, old_role, new_role, granted_by, reason) VALUES (?, ?, ?, ?, ?)",
                user.getId(), Role.USER.name(), Role.MUNICIPAL_OFFICIAL.name(), officialId, "Staff account created in the portal");
        log.info("Official {} created staff account {} ({})", officialId, user.getEmail(), user.getId());
        return list().stream().filter(m -> m.id().equals(user.getId())).findFirst().orElseThrow();
    }

    /** Takes portal access away (the account becomes a normal commuter account). */
    @Transactional
    public void revoke(UUID officialId, UUID userId) {
        if (officialId.equals(userId)) {
            throw new ApiException(HttpStatus.CONFLICT, "CANNOT_REVOKE_SELF", "You can't remove your own access");
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "No such account"));
        if (user.getRole() != Role.MUNICIPAL_OFFICIAL) {
            throw new ApiException(HttpStatus.CONFLICT, "NOT_STAFF", "Only municipal official accounts can be removed here");
        }
        user.setRole(Role.USER);
        userRepository.save(user);
        jdbc.update("INSERT INTO role_grants (user_id, old_role, new_role, granted_by, reason) VALUES (?, ?, ?, ?, ?)",
                userId, Role.MUNICIPAL_OFFICIAL.name(), Role.USER.name(), officialId, "Access removed in the portal");
        log.info("Official {} removed staff access for {}", officialId, userId);
    }

    private static java.time.Instant instant(Timestamp t) {
        return t != null ? t.toInstant() : null;
    }
}
