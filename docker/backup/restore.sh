#!/bin/sh
# Restore (decision 14): the database first, then the photos. Stop the API first, then:
#   docker compose --env-file .env.production -f compose.prod.yml run --rm \
#     -v /secure/age-identity.txt:/run/age/identity.txt:ro backup restore.sh latest
# and start the stack again with `up -d`. Replaces the whole database; copies photos back
# without deleting any (the orphan sweep removes leftovers after a day).
set -eu
: "${BACKUP_ROOT:?}" "${S3_BUCKET:?}" "${PGUSER:?}"
identity="${AGE_IDENTITY_FILE:-/run/age/identity.txt}"
want="${1:-}"
db="${PGDATABASE:-family}"
[ -n "$want" ] || { echo "usage: restore.sh <dump file name | latest>" >&2; exit 2; }
[ -r "$identity" ] || { echo "restore: no age identity at $identity (mount it read-only)" >&2; exit 2; }
if [ "$want" = latest ]; then
  want="$(rclone lsf --files-only "${BACKUP_ROOT}/db/" \
    | grep -E '^family-[0-9]{8}T[0-9]{6}Z\.dump\.age$' | sort -r | head -n 1)"
fi
[ -n "$want" ] || { echo "restore: no dumps under ${BACKUP_ROOT}/db/" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "restore: fetching db/${want}"
rclone copyto "${BACKUP_ROOT}/db/${want}" "$tmp/db.dump.age"
age --decrypt --identity "$identity" --output "$tmp/db.dump" "$tmp/db.dump.age"
pg_restore --list "$tmp/db.dump" >/dev/null

echo "restore: recreating database ${db}"
psql -v ON_ERROR_STOP=1 -q -d postgres \
  -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE)" \
  -c "CREATE DATABASE \"${db}\" OWNER \"${PGUSER}\""
psql -v ON_ERROR_STOP=1 -q -d "$db" -f /grants/20-app-grants.sql
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -d "$db" "$tmp/db.dump"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f /grants/20-app-grants.sql

echo "restore: copying photos back"
rclone copy "${BACKUP_ROOT}/photos/current" "photosrw:${S3_BUCKET}"
echo "restore: done (${want}). Start the stack again."
