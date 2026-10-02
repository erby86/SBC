#!/usr/bin/env bash
# Monthly restore drill (baseline-v8 §5): restores the newest backup into a scratch
# database, compares it with the live database, then drops the scratch database.
#   infra/scripts/pg-restore-test.sh            # newest daily dump
#   infra/scripts/pg-restore-test.sh <file>     # specific dump
set -euo pipefail

CONTAINER="${CONTAINER:-sbc-noc-dev-db}"
DB="${DB:-sbc_noc}"
DB_USER="${DB_USER:-sbc_noc}"
DEST="${DEST:-/opt/sbc-backups/sbc-noc-dev}"
SCRATCH="${DB}_restore_test"
here="$(cd "$(dirname "$0")" && pwd)"

file="${1:-$(find "$DEST/daily" -maxdepth 1 -name "${DB}-*.dump" -type f | sort -r | head -n 1)}"
[[ -n "$file" ]] || { echo "no backup found in $DEST/daily" >&2; exit 1; }

psql_c() { docker exec "$CONTAINER" psql -U "$DB_USER" -d "$1" -tAc "$2"; }
cleanup() { psql_c postgres "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null; }
trap cleanup EXIT
cleanup

CONTAINER="$CONTAINER" DB_USER="$DB_USER" "$here/pg-restore.sh" "$file" "$SCRATCH"

summary="SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema'))
  || ' tables, ' || (SELECT count(*) FROM public.schema_migrations) || ' migrations'"
live="$(psql_c "$DB" "$summary")"
restored="$(psql_c "$SCRATCH" "$summary")"
echo "live:     $live"
echo "restored: $restored"
if [[ "$live" == "$restored" ]]; then
  echo "RESTORE TEST PASSED ($file)"
else
  echo "RESTORE TEST FAILED: structure differs (a migration may have run after this backup)" >&2
  exit 1
fi
