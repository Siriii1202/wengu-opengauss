#!/usr/bin/env bash
set -e
: "${WENGU_ADMIN_PASSWORD:?Set GAUSS_ADMIN_PASSWORD in .env}"
: "${WENGU_DB_PASSWORD:?Set PGPASSWORD in .env}"

gsql -v ON_ERROR_STOP=1 -U omm -d postgres \
    -v admin_password="$WENGU_ADMIN_PASSWORD" -v app_password="$WENGU_DB_PASSWORD" <<'SQL'
ALTER ROLE omm PASSWORD :'admin_password';
CREATE USER wengu_app WITH LOGIN PASSWORD :'app_password';
CREATE DATABASE wengu_lab OWNER wengu_app TEMPLATE template0 ENCODING 'UTF8' DBCOMPATIBILITY 'PG';
SQL

gsql -v ON_ERROR_STOP=1 -U omm -d wengu_lab <<'SQL'
GRANT USAGE, CREATE ON SCHEMA public TO wengu_app;
SQL
