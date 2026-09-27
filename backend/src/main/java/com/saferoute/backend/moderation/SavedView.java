package com.saferoute.backend.moderation;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/** A staff member's named portal queue setup; {@code config} is the portal's own JSON. */
@Entity
@Table(name = "saved_views")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SavedView {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 80)
    private String name;

    @Column(nullable = false, columnDefinition = "text")
    private String config;

    @Column(name = "created_at", nullable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();
}
