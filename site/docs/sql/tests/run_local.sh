#!/usr/bin/env bash
# Creator-Hub-Migration lokal gegen eine leere PostgreSQL-Datenbank (≥ 15) testen.
#   PGHOST=… PGPORT=… PGUSER=postgres bash docs/sql/tests/run_local.sh
# Prüft: Migration läuft, ist wiederholbar, alle RLS-/Unveränderbarkeitstests bestehen, Rückbau läuft.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=${CREATOR_TEST_DB:-creatortest}
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$P -d "$DB" -f docs/sql/tests/local_supabase_stub.sql
$P -d "$DB" -f docs/sql/2026-10-22_creator_hub.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/2026-10-22_creator_hub.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/tests/creator_hub_rls_test.sql 2>&1 | grep -E "ok:|FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
echo "--- Phase 2"
$P -d "$DB" -f docs/sql/2026-10-23_creator_hub_phase2.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/2026-10-23_creator_hub_phase2.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/tests/creator_hub_rls_test.sql 2>&1 | grep -E "FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
$P -d "$DB" -f docs/sql/tests/creator_hub_phase2_test.sql 2>&1 | grep -E "ok:|FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
echo "--- Phase 3"
$P -d "$DB" -f docs/sql/2026-10-24_creator_hub_phase3.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/2026-10-24_creator_hub_phase3.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/tests/creator_hub_rls_test.sql 2>&1 | grep -E "FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
$P -d "$DB" -f docs/sql/tests/creator_hub_phase2_test.sql 2>&1 | grep -E "FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
$P -d "$DB" -f docs/sql/tests/creator_hub_phase3_test.sql 2>&1 | grep -E "ok:|FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
echo "--- Phase 4"
$P -d "$DB" -f docs/sql/2026-10-25_creator_hub_phase4.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/2026-10-25_creator_hub_phase4.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/tests/creator_hub_rls_test.sql 2>&1 | grep -E "FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
$P -d "$DB" -f docs/sql/tests/creator_hub_phase2_test.sql 2>&1 | grep -E "FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
$P -d "$DB" -f docs/sql/tests/creator_hub_phase3_test.sql 2>&1 | grep -E "FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
$P -d "$DB" -f docs/sql/tests/creator_hub_phase4_test.sql 2>&1 | grep -E "ok:|FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //'
$P -d "$DB" -f docs/sql/2026-10-25_creator_hub_phase4_rollback.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/tests/creator_hub_phase3_test.sql 2>&1 | grep -E "FAIL|ERROR|PASSED" | sed 's/.*NOTICE:  //' | sed 's/^/nach Rückbau Phase 4: /'
$P -d "$DB" -f docs/sql/2026-10-24_creator_hub_phase3_rollback.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/2026-10-23_creator_hub_phase2_rollback.sql 2>&1 | grep -v NOTICE || true
$P -d "$DB" -f docs/sql/2026-10-22_creator_hub_rollback.sql 2>&1 | grep -v NOTICE || true
left=$($P -d "$DB" -tAc "select count(*) from pg_tables where tablename like 'lr_creator%'")
[ "$left" = "0" ] && echo "ok: Rückbau vollständig" || { echo "FAIL: Rückbau unvollständig ($left Tabellen)"; exit 1; }
