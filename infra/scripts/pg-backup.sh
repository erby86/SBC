#!/usr/bin/env bash
# Daily pg_dump of sbc_noc with rotation: 14 daily + 8 weekly (baseline-v8 §5, M02).
# Runs on sbc-ubuntu from cron; uses pg_dump inside the db container (no host port needed).
#   CONTAINER=sbc-noc-dev-db DEST=/opt/sbc-backups/sbc-noc-dev infra/scripts/pg-backup.sh
set -euo pipefail
umask 077

CONTAINER="${CONTAINER:-sbc-noc-dev-db}"
DB="${DB:-sbc_noc}"
DB_USER="${DB_USER:-sbc_noc}"
DEST="${DEST:-/opt/sbc-backups/sbc-noc-dev}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
week="$(date -u +%G-W%V)"
mkdir -p "$DEST/daily" "$DEST/weekly"

file="$DEST/daily/${DB}-${stamp}.dump"
tmp="$file.partial"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB" -Fc >"$tmp"
# A dump that pg_restore cannot list is not a backup.
docker exec -i "$CONTAINER" pg_restore --list >/dev/null <"$tmp"
mv "$tmp" "$file"
echo "backup ok: $file ($(du -h "$file" | cut -f1))"

# First successful dump of each ISO week becomes the weekly copy.
if ! ls "$DEST/weekly/${DB}-${week}"-*.dump >/dev/null 2>&1; then
  cp "$file" "$DEST/weekly/${DB}-${week}-${stamp}.dump"
  echo "weekly copy: ${DB}-${week}"
fi

prune() { # dir keep
  find "$1" -maxdepth 1 -name "${DB}-*.dump" -type f | sort -r | tail -n +"$(($2 + 1))" | xargs -r rm -f --
}
prune "$DEST/daily" "$KEEP_DAILY"
prune "$DEST/weekly" "$KEEP_WEEKLY"
