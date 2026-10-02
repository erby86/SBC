#!/usr/bin/env bash
# Restores a pg_dump file into a NEW database inside the db container. Never overwrites:
# refuses if the target database already exists (drop or rename it yourself first).
#   infra/scripts/pg-restore.sh /opt/sbc-backups/sbc-noc-dev/daily/<file>.dump sbc_noc_restored
set -euo pipefail

file="${1:?usage: pg-restore.sh <dump-file> <target-db>}"
target="${2:?usage: pg-restore.sh <dump-file> <target-db>}"
CONTAINER="${CONTAINER:-sbc-noc-dev-db}"
DB_USER="${DB_USER:-sbc_noc}"

[[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "invalid database name: $target" >&2; exit 1; }
[[ -r "$file" ]] || { echo "cannot read $file" >&2; exit 1; }

exists="$(docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$target'")"
if [[ "$exists" == "1" ]]; then
  echo "database $target already exists — refusing to overwrite" >&2
  exit 1
fi

docker exec "$CONTAINER" createdb -U "$DB_USER" "$target"
docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$target" --no-owner --exit-on-error <"$file"
echo "restored $file -> $target"
