#!/bin/sh
# First start only (docker-entrypoint-initdb.d): the login role the API uses (decision 12).
# POSTGRES_USER (family_owner) owns the database and runs migrations and backups.
set -eu
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE family_app LOGIN PASSWORD :'app_password';
SQL
