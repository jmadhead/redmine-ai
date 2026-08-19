#!/bin/bash
set -e

POSTGRES_HOST="${REDMINE_DB_POSTGRES:-postgres}"
POSTGRES_PORT="${REDMINE_DB_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-redmine}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-redmine}"
POSTGRES_DB="${POSTGRES_DB:-redmine}"

export RAILS_ENV="${RAILS_ENV:-production}"

REDMINE_DIR="/usr/src/redmine"

echo "==> Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until bash -c "echo > /dev/tcp/${POSTGRES_HOST}/${POSTGRES_PORT}" 2>/dev/null; do
    echo "    PostgreSQL is unavailable - sleeping 2s"
    sleep 2
done
echo "==> PostgreSQL is up."

echo "==> Configuring Redmine database..."

cat > "${REDMINE_DIR}/config/database.yml" <<EOF
production:
  adapter: postgresql
  database: ${POSTGRES_DB}
  host: ${POSTGRES_HOST}
  port: ${POSTGRES_PORT}
  username: ${POSTGRES_USER}
  password: "${POSTGRES_PASSWORD}"
  encoding: utf8
EOF

chown redmine:redmine "${REDMINE_DIR}/config/database.yml"
chmod 600 "${REDMINE_DIR}/config/database.yml"

echo "==> Preparing Redmine directories..."

mkdir -p \
    "${REDMINE_DIR}/files" \
    "${REDMINE_DIR}/log" \
    "${REDMINE_DIR}/tmp" \
    "${REDMINE_DIR}/tmp/pdf" \
    "${REDMINE_DIR}/public/plugin_assets"

chown -R redmine:redmine \
    "${REDMINE_DIR}/files" \
    "${REDMINE_DIR}/log" \
    "${REDMINE_DIR}/tmp" \
    "${REDMINE_DIR}/public/plugin_assets"

echo "==> Running database migrations..."

gosu redmine bundle exec rake db:migrate

echo "==> Starting Redmine..."

exec gosu redmine bundle exec rails server \
    -e production \
    -b 0.0.0.0 \
    -p 3000
