package com.saferoute.backend.moderation;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.common.PageResponse;
import com.saferoute.backend.confirmation.HazardAuditLog;
import com.saferoute.backend.hazard.*;
import com.saferoute.backend.hazard.dto.HazardResponse;
import com.saferoute.backend.moderation.dto.ActivityEntry;
import com.saferoute.backend.moderation.dto.ModerationStats;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.*;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Read-only queries behind the municipal portal: the filtered moderation queue, dashboard
 * statistics and the staff activity feed. Native SQL, like {@link HazardRepository}, so each
 * query can be pasted into psql. Every value reaches SQL as a bound parameter; the only SQL
 * assembled from code is fixed fragments chosen from enums.
 */
@Service
@Transactional(readOnly = true)
public class ModerationQueryService {

    /** Shortcuts for the portal's queue tabs. */
    public enum View {
        /** Disputed, unverified high severity, or nobody has weighed in for a day. */
        ATTENTION, HIGH, CONTESTED, EXPIRING, UNCONFIRMED, ACTIVE, REMOVED,
        /** Active and not yet assigned to a department. */
        UNASSIGNED,
        /** Active and reported in the last day, so a new report is visible straight away. */
        RECENT,
        /** Active, but a week passed without staff review. Only here and in ACTIVE; still on the commuter map. */
        ARCHIVED,
        /** Active hazards that other people's matching reports were collated into. */
        DUPLICATES
    }

    public enum Sort { REVIEW, NEWEST, OLDEST, SEVERITY, CONFIDENCE, DISPUTED, CONFIRMED, EXPIRING, PRIORITY, UPDATED }

    /** In the {@code departments} filter: hazards nobody is assigned to. */
    public static final String UNASSIGNED = "UNASSIGNED";

    /** Everything optional; {@code bbox} is minLat, minLon, maxLat, maxLon. */
    public record QueueFilter(View view, String statuses, String types, String severities, String confidences,
                              Instant from, Instant to, double[] bbox, String query, Sort sort,
                              String departments, String priorities) {
    }

    static final int MAX_STATS_DAYS = 366;
    static final int MAX_QUERY_LENGTH = 100;

    private static final String ACTIVE = "h.status IN ('REPORTED', 'VERIFIED', 'DISPUTED')";
    /** Working queues leave out archived hazards: they have their own tab. */
    private static final String WORKING = "(" + ACTIVE + " AND h.archived_at IS NULL)";

    /** Must match {@link HazardLifecycle#confidence}; ModerationQueryIntegrationTest checks they agree. */
    static final String CONFIDENCE = """
        (CASE WHEN h.status NOT IN ('REPORTED', 'VERIFIED', 'DISPUTED') THEN NULL
              WHEN h.status = 'DISPUTED' THEN 'CONTESTED'
              WHEN h.confirmation_count = 0 AND h.dispute_count = 0 THEN 'UNCONFIRMED'
              WHEN h.status = 'VERIFIED' AND h.confirmation_count >= 5
                   AND h.confirmation_count >= 0.8 * (h.confirmation_count + h.dispute_count) THEN 'HIGH'
              WHEN h.status = 'VERIFIED'
                   AND h.confirmation_count >= 0.6 * (h.confirmation_count + h.dispute_count) THEN 'MEDIUM'
              ELSE 'LOW' END)""";

    private static final String UNCONFIRMED = "(" + WORKING + " AND h.confirmation_count = 0 AND h.dispute_count = 0)";

    private static final String ATTENTION = "(h.archived_at IS NULL AND (h.status = 'DISPUTED'"
            + " OR (h.status = 'REPORTED' AND h.severity = 'HIGH')"
            + " OR (" + UNCONFIRMED + " AND h.created_at < CAST(:now AS timestamptz) - interval '24 hours')))";

    private final NamedParameterJdbcTemplate jdbc;
    private final HazardRepository hazardRepository;
    private final ExpiryPolicy expiryPolicy;
    private final MunicipalDepartments departments;

    public ModerationQueryService(NamedParameterJdbcTemplate jdbc, HazardRepository hazardRepository,
                                  ExpiryPolicy expiryPolicy, MunicipalDepartments departments) {
        this.jdbc = jdbc;
        this.hazardRepository = hazardRepository;
        this.expiryPolicy = expiryPolicy;
        this.departments = departments;
    }

    // ------------------------------------------------------------------ queue

    public PageResponse<HazardResponse> queue(QueueFilter filter, int page, int size) {
        MapSqlParameterSource params = new MapSqlParameterSource("now", OffsetDateTime.now(ZoneOffset.UTC));
        String where = where(filter, params);
        long total = Optional.ofNullable(jdbc.queryForObject("SELECT count(*) FROM hazards h WHERE " + where, params, Long.class))
                .orElse(0L);
        params.addValue("limit", size).addValue("offset", (long) page * size);
        List<UUID> ids = jdbc.queryForList("""
                SELECT h.id FROM hazards h JOIN users u ON u.id = h.reporter_id
                WHERE %s
                ORDER BY %s, h.id
                LIMIT :limit OFFSET :offset
                """.formatted(where, orderBy(filter.sort())), params, UUID.class);
        Map<UUID, Hazard> byId = hazardRepository.findByIdIn(ids).stream()
                .collect(Collectors.toMap(Hazard::getId, Function.identity()));
        List<HazardResponse> items = ids.stream().map(byId::get).filter(Objects::nonNull).map(HazardResponse::from).toList();
        return PageResponse.of(items, page, size, total);
    }

    private String where(QueueFilter f, MapSqlParameterSource params) {
        List<String> conditions = new ArrayList<>();
        if (f.view() != null) {
            conditions.add(viewCondition(f.view()));
        } else {
            params.addValue("statuses", HazardService.parseStatuses(f.statuses()));
            conditions.add("h.status = ANY(string_to_array(:statuses, ','))");
        }
        String types = HazardService.parseTypes(f.types());
        if (types != null) {
            params.addValue("types", types);
            conditions.add("h.type = ANY(string_to_array(:types, ','))");
        }
        if (f.severities() != null && !f.severities().isBlank()) {
            params.addValue("severities", HazardService.parseEnumCsv(f.severities(), Severity.class, "severities"));
            conditions.add("h.severity = ANY(string_to_array(:severities, ','))");
        }
        if (f.confidences() != null && !f.confidences().isBlank()) {
            params.addValue("confidences", HazardService.parseEnumCsv(f.confidences(), Confidence.class, "confidences"));
            conditions.add(CONFIDENCE + " = ANY(string_to_array(:confidences, ','))");
        }
        if (f.departments() != null && !f.departments().isBlank()) {
            List<String> codes = Arrays.stream(f.departments().split(",")).map(String::trim).filter(s -> !s.isEmpty())
                    .map(String::toUpperCase).distinct().toList();
            for (String code : codes) {
                if (!code.equals(UNASSIGNED) && !departments.contains(code)) throw badRequest("Unknown department: " + code);
            }
            List<String> named = codes.stream().filter(c -> !c.equals(UNASSIGNED)).toList();
            List<String> any = new ArrayList<>();
            if (!named.isEmpty()) {
                params.addValue("departments", String.join(",", named));
                any.add("h.assigned_department = ANY(string_to_array(:departments, ','))");
            }
            if (codes.contains(UNASSIGNED)) any.add("h.assigned_department IS NULL");
            conditions.add("(" + String.join(" OR ", any) + ")");
        }
        if (f.priorities() != null && !f.priorities().isBlank()) {
            params.addValue("priorities", HazardService.parseEnumCsv(f.priorities(), MunicipalPriority.class, "priorities"));
            conditions.add("h.municipal_priority = ANY(string_to_array(:priorities, ','))");
        }
        if (f.from() != null) {
            params.addValue("from", OffsetDateTime.ofInstant(f.from(), ZoneOffset.UTC));
            conditions.add("h.created_at >= :from");
        }
        if (f.to() != null) {
            params.addValue("to", OffsetDateTime.ofInstant(f.to(), ZoneOffset.UTC));
            conditions.add("h.created_at < :to");
        }
        if (f.bbox() != null) {
            double[] b = f.bbox();
            if (b.length != 4 || b[0] >= b[2] || b[1] >= b[3] || Math.abs(b[0]) > 90 || Math.abs(b[2]) > 90
                    || Math.abs(b[1]) > 180 || Math.abs(b[3]) > 180) {
                throw badRequest("bbox must be minLat,minLon,maxLat,maxLon with min < max");
            }
            params.addValue("minLat", b[0]).addValue("minLon", b[1]).addValue("maxLat", b[2]).addValue("maxLon", b[3]);
            conditions.add("ST_Intersects(h.location, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326)::geography)");
        }
        if (f.query() != null && !f.query().isBlank()) {
            String q = f.query().trim();
            if (q.length() > MAX_QUERY_LENGTH) throw badRequest("q must be at most " + MAX_QUERY_LENGTH + " characters");
            String escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
            params.addValue("q", "%" + escaped + "%");
            // Types match on their readable form, so "open manhole" finds OPEN_MANHOLE.
            conditions.add("(h.description ILIKE :q OR replace(h.type, '_', ' ') ILIKE :q)");
        }
        return String.join(" AND ", conditions);
    }

    private String viewCondition(View view) {
        return switch (view) {
            case ATTENTION -> ATTENTION;
            case HIGH -> "(" + WORKING + " AND h.severity = 'HIGH')";
            case CONTESTED -> "(h.status = 'DISPUTED' AND h.archived_at IS NULL)";
            case EXPIRING -> expiringCondition();
            case UNCONFIRMED -> UNCONFIRMED;
            case ACTIVE -> ACTIVE;
            case REMOVED -> "h.status = 'REMOVED'";
            case UNASSIGNED -> "(" + WORKING + " AND h.assigned_department IS NULL)";
            case RECENT -> "(" + WORKING + " AND h.created_at >= CAST(:now AS timestamptz) - interval '24 hours')";
            case ARCHIVED -> "(" + ACTIVE + " AND h.archived_at IS NOT NULL)";
            case DUPLICATES -> "(" + ACTIVE + " AND h.merged_report_count > 0)";
        };
    }

    /** Mirrors {@link ExpiryPolicy#isExpiringSoon}: the last fifth of the type's time-to-live. */
    private String expiringCondition() {
        String windows = Arrays.stream(HazardType.values())
                .map(t -> "WHEN '" + t.name() + "' THEN " + expiryPolicy.ttlFor(t).dividedBy(5).toSeconds())
                .collect(Collectors.joining(" "));
        return "(" + WORKING + " AND h.expires_at >= CAST(:now AS timestamptz)"
                + " AND h.expires_at <= CAST(:now AS timestamptz) + (CASE h.type " + windows + " ELSE "
                + Duration.ofDays(3).dividedBy(5).toSeconds() + " END) * interval '1 second')";
    }

    private static String orderBy(Sort sort) {
        return switch (sort == null ? Sort.REVIEW : sort) {
            // Disputed first, then the least-trusted reporters: reputation orders, it never decides.
            case REVIEW -> "(h.status = 'DISPUTED') DESC, u.reputation_score ASC, h.updated_at DESC";
            case NEWEST -> "h.created_at DESC";
            case OLDEST -> "h.created_at ASC";
            case SEVERITY -> "CASE h.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, h.created_at DESC";
            case CONFIDENCE -> "CASE " + CONFIDENCE + " WHEN 'CONTESTED' THEN 0 WHEN 'UNCONFIRMED' THEN 1 WHEN 'LOW' THEN 2"
                    + " WHEN 'MEDIUM' THEN 3 WHEN 'HIGH' THEN 4 ELSE 5 END, h.created_at DESC";
            case DISPUTED -> "h.dispute_count DESC, h.created_at DESC";
            case CONFIRMED -> "h.confirmation_count DESC, h.created_at DESC";
            case EXPIRING -> "h.expires_at ASC";
            case UPDATED -> "h.updated_at DESC";
            // Unset priority sorts after LOW: the city hasn't ranked it yet.
            case PRIORITY -> "CASE h.municipal_priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2"
                    + " WHEN 'LOW' THEN 3 ELSE 4 END, CASE h.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,"
                    + " h.created_at ASC";
        };
    }

    // ------------------------------------------------------------------ stats

    public ModerationStats stats(Instant from, Instant to, String timeZone) {
        ZoneId zone;
        try {
            zone = ZoneId.of(timeZone);
        } catch (DateTimeException e) {
            throw badRequest("Unknown time zone: " + timeZone);
        }
        Instant now = Instant.now();
        Instant end = to != null ? to : now;
        Instant start = from != null ? from : end.minus(Duration.ofDays(7));
        if (!start.isBefore(end)) throw badRequest("from must be before to");
        if (Duration.between(start, end).toDays() > MAX_STATS_DAYS) {
            throw badRequest("The range can be at most " + MAX_STATS_DAYS + " days");
        }
        Duration length = Duration.between(start, end);
        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("now", OffsetDateTime.ofInstant(now, ZoneOffset.UTC))
                .addValue("from", OffsetDateTime.ofInstant(start, ZoneOffset.UTC))
                .addValue("to", OffsetDateTime.ofInstant(end, ZoneOffset.UTC))
                .addValue("prevFrom", OffsetDateTime.ofInstant(start.minus(length), ZoneOffset.UTC))
                .addValue("tz", zone.getId());

        Map<String, Long> queueCounts = new LinkedHashMap<>();
        String counts = Arrays.stream(View.values())
                .map(v -> "count(*) FILTER (WHERE " + viewCondition(v) + ") AS " + v.name().toLowerCase())
                .collect(Collectors.joining(", "));
        jdbc.query("SELECT " + counts + ", count(*) FILTER (WHERE h.created_at >= :from AND h.created_at < :to) AS reported,"
                        + " count(*) FILTER (WHERE h.status = 'RESOLVED' AND h.resolved_at >= :from AND h.resolved_at < :to) AS resolved"
                        + " FROM hazards h", p, (ResultSet rs) -> {
            for (View v : View.values()) queueCounts.put(v.name().toLowerCase(), rs.getLong(v.name().toLowerCase()));
            queueCounts.put("_reported", rs.getLong("reported"));
            queueCounts.put("_resolved", rs.getLong("resolved"));
        });
        long reported = queueCounts.remove("_reported");
        long resolved = queueCounts.remove("_resolved");
        var totals = new ModerationStats.Totals(queueCounts.get("active"), queueCounts.get("high"),
                queueCounts.get("attention"), reported, resolved);

        List<ModerationStats.Count> byType = counts(p, "h.type", HazardType.values());
        List<ModerationStats.Count> bySeverity = counts(p, "h.severity", Severity.values());

        // A hazard is in the backlog at the end of a day if it was reported by then and not yet
        // closed. Expired hazards have no resolved_at; their last update is when they expired.
        List<ModerationStats.Day> daily = jdbc.query("""
                WITH days AS (
                    SELECT d::date AS day
                    FROM generate_series((CAST(:from AS timestamptz) AT TIME ZONE :tz)::date,
                                         (CAST(:to AS timestamptz) AT TIME ZONE :tz)::date, interval '1 day') d
                ), bounds AS (
                    SELECT day, (day::timestamp AT TIME ZONE :tz) AS day_start,
                           ((day + 1)::timestamp AT TIME ZONE :tz) AS day_end
                    FROM days
                )
                SELECT b.day,
                       (SELECT count(*) FROM hazards h WHERE h.created_at >= b.day_start AND h.created_at < b.day_end) AS reported,
                       (SELECT count(*) FROM hazards h WHERE h.status = 'RESOLVED'
                            AND h.resolved_at >= b.day_start AND h.resolved_at < b.day_end) AS resolved,
                       (SELECT count(*) FROM hazards h WHERE h.created_at < b.day_end
                            AND COALESCE(h.resolved_at, CASE WHEN h.status = 'EXPIRED' THEN h.updated_at END,
                                         'infinity'::timestamptz) >= b.day_end) AS backlog,
                       r.high, r.medium, r.low, s.created, s.merged
                FROM bounds b
                CROSS JOIN LATERAL (
                    SELECT count(*) FILTER (WHERE h.severity = 'HIGH') AS high,
                           count(*) FILTER (WHERE h.severity = 'MEDIUM') AS medium,
                           count(*) FILTER (WHERE h.severity = 'LOW') AS low
                    FROM hazards h WHERE h.created_at >= b.day_start AND h.created_at < b.day_end) r
                CROSS JOIN LATERAL (
                    SELECT count(*) FILTER (WHERE s.processing_status = 'CREATED') AS created,
                           count(*) FILTER (WHERE s.processing_status = 'MERGED') AS merged
                    FROM hazard_submissions s WHERE s.created_at >= b.day_start AND s.created_at < b.day_end) s
                ORDER BY b.day
                """, p, (rs, i) -> new ModerationStats.Day(rs.getObject("day", LocalDate.class),
                rs.getLong("reported"), rs.getLong("resolved"), rs.getLong("backlog"),
                rs.getLong("high"), rs.getLong("medium"), rs.getLong("low"), rs.getLong("created"), rs.getLong("merged")));

        String hours = "avg(extract(epoch FROM h.resolved_at - h.created_at)) / 3600.0";
        Double average = jdbc.queryForObject("SELECT " + hours + " FROM hazards h WHERE h.status = 'RESOLVED'"
                + " AND h.resolved_at >= :from AND h.resolved_at < :to", p, Double.class);
        Double previous = jdbc.queryForObject("SELECT " + hours + " FROM hazards h WHERE h.status = 'RESOLVED'"
                + " AND h.resolved_at >= :prevFrom AND h.resolved_at < :from", p, Double.class);
        List<ModerationStats.TypeResolution> resolutionByType = jdbc.query("SELECT h.type, " + hours + " AS hours, count(*) AS n"
                        + " FROM hazards h WHERE h.status = 'RESOLVED' AND h.resolved_at >= :from AND h.resolved_at < :to"
                        + " GROUP BY h.type ORDER BY hours DESC", p,
                (rs, i) -> new ModerationStats.TypeResolution(rs.getString("type"), rs.getDouble("hours"), rs.getLong("n")));

        ModerationStats.Outcomes outcomes = jdbc.queryForObject("""
                SELECT count(*) FILTER (WHERE new_status = 'RESOLVED') AS resolved,
                       count(*) FILTER (WHERE new_status = 'EXPIRED') AS expired,
                       count(*) FILTER (WHERE new_status = 'REMOVED') AS removed,
                       count(*) FILTER (WHERE old_status = 'RESOLVED' AND new_status IN ('REPORTED', 'VERIFIED', 'DISPUTED')) AS reopened
                FROM hazard_status_history WHERE changed_at >= :from AND changed_at < :to
                """, p, (rs, i) -> new ModerationStats.Outcomes(
                rs.getLong("resolved"), rs.getLong("expired"), rs.getLong("removed"), rs.getLong("reopened")));

        // A hazard can be verified, disputed and verified again: the first time is what counts.
        String firstVerified = "WITH fv AS (SELECT hazard_id, min(changed_at) AS at FROM hazard_status_history"
                + " WHERE new_status = 'VERIFIED' GROUP BY hazard_id)";
        String verifyHours = "avg(extract(epoch FROM fv.at - h.created_at)) / 3600.0";
        ModerationStats.Verification verification = jdbc.queryForObject(firstVerified
                        + " SELECT " + verifyHours + " AS hours, count(*) AS n FROM fv JOIN hazards h ON h.id = fv.hazard_id"
                        + " WHERE fv.at >= :from AND fv.at < :to", p,
                (rs, i) -> new ModerationStats.Verification(nullableDouble(rs, "hours"), rs.getLong("n"), jdbc.query(firstVerified
                                + " SELECT h.type, " + verifyHours + " AS hours, count(*) AS n FROM fv JOIN hazards h ON h.id = fv.hazard_id"
                                + " WHERE fv.at >= :from AND fv.at < :to GROUP BY h.type ORDER BY hours DESC", p,
                        (r, j) -> new ModerationStats.TypeResolution(r.getString("type"), r.getDouble("hours"), r.getLong("n")))));

        // Every report counts here, including ones merged into an existing hazard.
        List<ModerationStats.HourCount> reportTimes = jdbc.query("""
                SELECT extract(isodow FROM s.created_at AT TIME ZONE :tz)::int AS dow,
                       extract(hour FROM s.created_at AT TIME ZONE :tz)::int AS hr, count(*) AS n
                FROM hazard_submissions s WHERE s.created_at >= :from AND s.created_at < :to
                GROUP BY 1, 2 ORDER BY 1, 2
                """, p, (rs, i) -> new ModerationStats.HourCount(rs.getInt("dow"), rs.getInt("hr"), rs.getLong("n")));

        // 0.0015° is about 165 m here: close enough to be "the same place" for a pedestrian.
        List<ModerationStats.Hotspot> hotspots = jdbc.query("""
                SELECT avg(ST_Y(h.location::geometry)) AS lat, avg(ST_X(h.location::geometry)) AS lon, count(*) AS n,
                       mode() WITHIN GROUP (ORDER BY h.type) AS top_type
                FROM hazards h
                WHERE h.created_at >= :from AND h.created_at < :to AND h.status <> 'REMOVED'
                GROUP BY floor(ST_Y(h.location::geometry) / 0.0015), floor(ST_X(h.location::geometry) / 0.0015)
                HAVING count(*) >= 2
                ORDER BY n DESC, lat LIMIT 8
                """, p, (rs, i) -> new ModerationStats.Hotspot(rs.getDouble("lat"), rs.getDouble("lon"), rs.getLong("n"),
                rs.getString("top_type")));

        return new ModerationStats(start, end, zone.getId(), now, totals, queueCounts, byType, bySeverity, daily,
                new ModerationStats.Resolution(average, previous, resolved, resolutionByType),
                outcomes, verification, reportTimes, hotspots);
    }

    /** Postgres averages come back as numeric (BigDecimal); null when nothing matched. */
    private static Double nullableDouble(ResultSet rs, String column) throws SQLException {
        double value = rs.getDouble(column);
        return rs.wasNull() ? null : value;
    }

    /** Active hazards per value of {@code column}, including zeroes, largest first. */
    private List<ModerationStats.Count> counts(MapSqlParameterSource p, String column, Enum<?>[] values) {
        Map<String, Long> found = new HashMap<>();
        jdbc.query("SELECT " + column + " AS k, count(*) AS n FROM hazards h WHERE " + ACTIVE + " GROUP BY " + column, p,
                (ResultSet rs) -> { found.put(rs.getString("k"), rs.getLong("n")); });
        return Arrays.stream(values)
                .map(v -> new ModerationStats.Count(v.name(), found.getOrDefault(v.name(), 0L)))
                .sorted(Comparator.comparingLong(ModerationStats.Count::count).reversed())
                .toList();
    }

    // ------------------------------------------------------------------ activity

    public PageResponse<ActivityEntry> activity(UUID hazardId, String actions, boolean staffOnly, int page, int size) {
        MapSqlParameterSource p = new MapSqlParameterSource();
        List<String> conditions = new ArrayList<>(List.of("TRUE"));
        if (hazardId != null) {
            p.addValue("hazardId", hazardId);
            conditions.add("a.hazard_id = :hazardId");
        }
        if (actions != null && !actions.isBlank()) {
            p.addValue("actions", HazardService.parseEnumCsv(actions, HazardAuditLog.Action.class, "actions"));
            conditions.add("a.action = ANY(string_to_array(:actions, ','))");
        }
        if (staffOnly) conditions.add("u.role IN ('MODERATOR', 'MUNICIPAL_OFFICIAL')");
        String where = String.join(" AND ", conditions);
        String from = " FROM hazard_audit_log a JOIN hazards h ON h.id = a.hazard_id LEFT JOIN users u ON u.id = a.actor_id";

        long total = Optional.ofNullable(jdbc.queryForObject("SELECT count(*)" + from + " WHERE " + where, p, Long.class))
                .orElse(0L);
        p.addValue("limit", size).addValue("offset", (long) page * size);
        List<ActivityEntry> items = jdbc.query("""
                SELECT a.id, a.hazard_id, a.action, a.field_name, a.old_value, a.new_value, a.note, a.created_at,
                       a.actor_id, h.reporter_id, h.type, h.severity,
                       ST_Y(h.location::geometry) AS lat, ST_X(h.location::geometry) AS lon,
                       u.display_name, u.email, u.role
                """ + from + " WHERE " + where + " ORDER BY a.created_at DESC, a.id LIMIT :limit OFFSET :offset",
                p, (rs, i) -> activityEntry(rs));
        return PageResponse.of(items, page, size, total);
    }

    private static ActivityEntry activityEntry(ResultSet rs) throws SQLException {
        UUID actorId = rs.getObject("actor_id", UUID.class);
        String role = rs.getString("role");
        ActivityEntry.Actor actor;
        if (actorId == null) {
            actor = new ActivityEntry.Actor("SYSTEM", null, null, null);
        } else if ("MODERATOR".equals(role) || "MUNICIPAL_OFFICIAL".equals(role)) {
            actor = new ActivityEntry.Actor("STAFF", rs.getString("display_name"), rs.getString("email"), role);
        } else if (actorId.equals(rs.getObject("reporter_id", UUID.class))) {
            actor = new ActivityEntry.Actor("REPORTER", null, null, null);
        } else {
            actor = new ActivityEntry.Actor("COMMUNITY", null, null, null);
        }
        return new ActivityEntry(rs.getObject("id", UUID.class), rs.getObject("hazard_id", UUID.class),
                rs.getString("type"), rs.getString("severity"), rs.getDouble("lat"), rs.getDouble("lon"),
                rs.getString("action"), rs.getString("field_name"), rs.getString("old_value"), rs.getString("new_value"),
                rs.getString("note"), actor, rs.getObject("created_at", OffsetDateTime.class).toInstant());
    }

    private static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
    }
}
