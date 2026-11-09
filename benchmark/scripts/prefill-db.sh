#!/usr/bin/env bash
# Fills the benchmark database with N synthetic hazards so queries run against a realistic table
# instead of an empty one (reviewer: "an empty database").
#
#   benchmark/scripts/prefill-db.sh [N=100000] [DB=saferoute_bench]
#
# Needs the Postgres container up, the schema migrated (start the backend once) and at least one
# user (any simulator registers some). Half the hazards cluster densely around Makati CBD, half are
# spread over the whole Metro Manila coverage box; ~60% are active, the rest resolved/expired, with
# a realistic type/severity mix. Rows are tagged with description 'prefill' so they can be removed:
#   DELETE FROM hazards WHERE description = 'prefill';
set -euo pipefail
N="${1:-100000}"
DB="${2:-saferoute_bench}"
docker exec -i saferoute-postgres psql -U saferoute -d "$DB" -v ON_ERROR_STOP=1 -v n="$N" <<'SQL'
WITH reporter AS (SELECT id FROM users ORDER BY created_at LIMIT 1)
INSERT INTO hazards (type, location, description, status, severity, confirmation_count, reporter_id,
                     created_at, updated_at, last_confirmed_at, expires_at)
SELECT t.type,
       ST_SetSRID(ST_MakePoint(g.lon, g.lat), 4326)::geography,
       'prefill',
       s.status,
       sev.severity,
       (random() * 4)::int,
       (SELECT id FROM reporter),
       now() - (random() * interval '14 days'),
       now(),
       now(),
       CASE WHEN s.status IN ('REPORTED', 'VERIFIED', 'DISPUTED') THEN now() + interval '3 days' ELSE now() - interval '1 day' END
FROM generate_series(1, :n) AS i
CROSS JOIN LATERAL (SELECT random() AS r1, random() AS r2, random() AS r3, random() AS r4, random() AS r5, i AS i) AS rnd
CROSS JOIN LATERAL (SELECT CASE WHEN rnd.r1 < 0.5 THEN 14.5547 + (rnd.r2 - 0.5) * 0.09 ELSE 14.35 + rnd.r2 * 0.45 END AS lat,
                           CASE WHEN rnd.r1 < 0.5 THEN 121.0244 + (rnd.r3 - 0.5) * 0.09 ELSE 120.90 + rnd.r3 * 0.25 END AS lon) AS g
CROSS JOIN LATERAL (SELECT (ARRAY['FLOODING','BROKEN_SIDEWALK','OPEN_MANHOLE','POOR_LIGHTING','ACCESSIBILITY_BARRIER','CONSTRUCTION','PATH_OBSTRUCTION'])[1 + floor(rnd.r4 * 7)::int] AS type) AS t
CROSS JOIN LATERAL (SELECT CASE WHEN rnd.r5 < 0.35 THEN 'REPORTED' WHEN rnd.r5 < 0.50 THEN 'VERIFIED' WHEN rnd.r5 < 0.60 THEN 'DISPUTED'
                                WHEN rnd.r5 < 0.85 THEN 'RESOLVED' ELSE 'EXPIRED' END AS status) AS s
CROSS JOIN LATERAL (SELECT CASE WHEN rnd.r2 < 0.15 THEN 'HIGH' WHEN rnd.r2 < 0.55 THEN 'MEDIUM' ELSE 'LOW' END AS severity) AS sev;
ANALYZE hazards;
SELECT status, count(*) FROM hazards GROUP BY status ORDER BY status;
SQL
