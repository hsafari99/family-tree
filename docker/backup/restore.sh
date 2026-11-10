#!/bin/sh
# Restore (decision 14): the database first, then the photos. Stop the API first, then:
#   docker compose --env-file .env.production -f compose.prod.yml run --rm \
#     -v /secure/age-identity.txt:/run/age/identity.txt:ro restore restore.sh [--force] latest
# and start the stack again with `up -d`.
#
# The dump goes into a scratch database (<db>_restore) and is checked there. Only then are the
# databases swapped by renaming, in one transaction. A corrupt or wrong dump therefore never
# touches the live database. The previous database is dropped after the photos are copied back.
# Photos are copied without deleting any (the orphan sweep removes leftovers after a day).
# A database that already has tables needs --force.
# The database must be called "family": /grants/20-app-grants.sql names it. Don't run the backup
# timer while a restore is running.
set -euo pipefail
: "${BACKUP_ROOT:?}" "${S3_BUCKET:?}" "${PGUSER:?}"
force=no
if [ "${1:-}" = "--force" ]; then
  force=yes
  shift
fi
identity="${AGE_IDENTITY_FILE:-/run/age/identity.txt}"
want="${1:-}"
db="${PGDATABASE:-family}"
ident='^[a-z_][a-z0-9_]*$'
printf '%s' "$db" | grep -Eq "$ident" || { echo "restore: bad database name" >&2; exit 2; }
printf '%s' "$PGUSER" | grep -Eq "$ident" || { echo "restore: bad PGUSER" >&2; exit 2; }
[ -n "$want" ] || { echo "usage: restore.sh [--force] <dump file name | latest>" >&2; exit 2; }
[ -r "$identity" ] || { echo "restore: no age identity at $identity (mount it read-only)" >&2; exit 2; }

psqlx() { psql -v ON_ERROR_STOP=1 -q -X "$@"; }
scratch="${db}_restore"
old="${db}_old_$(date -u +%Y%m%d%H%M%S)"

# Refuse to replace a database that holds data unless asked to.
tables="$(psqlx -d postgres -Atc "select 1 from pg_database where datname = '${db}'" | head -n 1)"
if [ -n "$tables" ]; then
  n="$(psqlx -d "$db" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
  if [ "$n" != 0 ] && [ "$force" != yes ]; then
    echo "restore: database \"${db}\" has ${n} tables; run again with --force to replace it" >&2
    exit 2
  fi
fi

if [ "$want" = latest ]; then
  want="$(rclone lsf --files-only "${BACKUP_ROOT}/db/" \
    | grep -E '^family-[0-9]{8}T[0-9]{6}Z\.dump\.age$' | sort -r | head -n 1)"
fi
[ -n "$want" ] || { echo "restore: no dumps under ${BACKUP_ROOT}/db/" >&2; exit 1; }

cleanup() { psqlx -d postgres -c "DROP DATABASE IF EXISTS \"${scratch}\" WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "restore: restoring db/${want} into ${scratch}"
psqlx -d postgres \
  -c "DROP DATABASE IF EXISTS \"${scratch}\" WITH (FORCE)" \
  -c "CREATE DATABASE \"${scratch}\" OWNER \"${PGUSER}\""
# Streamed: the plaintext dump never touches the disk. A corrupt dump fails here, in the scratch
# database; the live one is untouched.
rclone cat "${BACKUP_ROOT}/db/${want}" \
  | age --decrypt --identity "$identity" \
  | pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -d "$scratch"
n="$(psqlx -d "$scratch" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
[ "$n" != 0 ] || { echo "restore: the dump restored no tables; nothing was changed" >&2; exit 1; }

echo "restore: swapping ${scratch} in for ${db}"
had=no
[ -z "$tables" ] || had=yes
swap="select pg_terminate_backend(pid) from pg_stat_activity
        where datname in ('${db}', '${scratch}') and pid <> pg_backend_pid();
      begin;"
[ "$had" = yes ] && swap="${swap} alter database \"${db}\" rename to \"${old}\";"
swap="${swap} alter database \"${scratch}\" rename to \"${db}\"; commit;"
printf '%s\n' "$swap" | psqlx -d postgres -o /dev/null

# The grants run after the swap: they name the live database, which only exists from here.
# From here the old database is kept until everything has worked, and put back if it doesn't.
rollback() {
  echo "restore: failed after the swap; putting the previous database back" >&2
  if [ "$had" = yes ]; then
    printf '%s\n' "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('${db}', '${old}') and pid <> pg_backend_pid();
      begin; alter database \"${db}\" rename to \"${scratch}\"; alter database \"${old}\" rename to \"${db}\"; commit;" \
      | psqlx -d postgres -o /dev/null || true
  fi
}
trap 'rollback; cleanup' INT TERM
if ! { psqlx -d "$db" -f /grants/20-app-grants.sql && rclone copy "${BACKUP_ROOT}/photos/current" "photosrw:${S3_BUCKET}"; }; then
  rollback
  exit 1
fi
trap - INT TERM
trap cleanup EXIT
if [ "$had" = yes ]; then
  psqlx -d postgres -c "DROP DATABASE IF EXISTS \"${old}\" WITH (FORCE)"
fi
echo "restore: done (${want}). Start the stack again."
