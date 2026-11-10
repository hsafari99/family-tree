#!/bin/sh
# Nightly backup (spec §8, decision 14): an age-encrypted pg_dump, then a mirror of the photos.
# The host timer runs: docker compose --env-file .env.production -f compose.prod.yml run --rm backup
# A failed dump uploads nothing and never rotates out a good backup.
# busybox ash (the Alpine image's sh) supports pipefail.
# shellcheck disable=SC3040
set -euo pipefail
: "${AGE_RECIPIENT:?AGE_RECIPIENT (the age public key) is required}"
: "${BACKUP_ROOT:?}" "${S3_BUCKET:?}"
keep="${BACKUP_KEEP:-14}"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
name="family-${ts}.dump.age"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "backup: dumping the database"
# Streamed: the plaintext dump never touches the disk. pipefail makes a failed pg_dump fail the
# run, so a partial dump is never uploaded or counted as a backup.
pg_dump --format=custom --no-owner --no-privileges \
  | age --encrypt --recipient "$AGE_RECIPIENT" --output "$tmp/db.dump.age"
[ -s "$tmp/db.dump.age" ] || { echo "backup: the encrypted dump is empty" >&2; exit 1; }
rclone copyto "$tmp/db.dump.age" "${BACKUP_ROOT}/db/${name}"
local_size="$(wc -c < "$tmp/db.dump.age" | tr -d ' ')"
remote_size="$(rclone size --json "${BACKUP_ROOT}/db/${name}" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
if [ "$remote_size" != "$local_size" ]; then
  echo "backup: uploaded dump has ${remote_size:-no} bytes, expected ${local_size}" >&2
  exit 1
fi
echo "backup: stored db/${name} (${local_size} bytes)"

# Only after a good upload: keep the newest $keep dumps.
{ rclone lsf --files-only "${BACKUP_ROOT}/db/" 2>/dev/null || true; } \
  | grep -E '^family-[0-9]{8}T[0-9]{6}Z\.dump\.age$' | sort -r | awk -v keep="$keep" 'NR > keep' \
  | while read -r old; do
      rclone deletefile "${BACKUP_ROOT}/db/${old}"
      echo "backup: removed db/${old}"
    done

echo "backup: mirroring photos"
rclone sync "photos:${S3_BUCKET}" "${BACKUP_ROOT}/photos/current" \
  --backup-dir "${BACKUP_ROOT}/photos/deleted/${ts}"
{ rclone lsf --dirs-only "${BACKUP_ROOT}/photos/deleted/" 2>/dev/null || true; } \
  | sort -r | awk -v keep="$keep" 'NR > keep' \
  | while read -r old; do
      rclone purge "${BACKUP_ROOT}/photos/deleted/${old%/}"
      echo "backup: removed photos/deleted/${old%/}"
    done
echo "backup: done"
