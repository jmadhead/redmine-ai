#!/bin/bash
set -e

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
REDMINE_DIR="/usr/src/redmine"

POSTGRES_USER="${POSTGRES_USER:-redmine}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-redmine}"
POSTGRES_DB="${POSTGRES_DB:-redmine}"

export RAILS_ENV="${RAILS_ENV:-production}"

echo "==> Checking PostgreSQL..."

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "==> Initializing PostgreSQL..."

    mkdir -p "$PGDATA"
    chown -R postgres:postgres "$PGDATA"

    gosu postgres initdb \
        --pgdata="$PGDATA" \
        --auth-local=trust \
        --auth-host=scram-sha-256

    # Allow PostgreSQL to listen locally inside the container.
    cat >> "$PGDATA/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = 5432
EOF

    echo "==> Starting PostgreSQL temporarily..."

    gosu postgres pg_ctl \
        -D "$PGDATA" \
        -w start

    echo "==> Creating Redmine database..."

    gosu postgres psql <<EOF
CREATE USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}';
CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};
EOF

    gosu postgres pg_ctl \
        -D "$PGDATA" \
        -w stop

else
    echo "==> Existing PostgreSQL database detected."
fi

echo "==> Starting PostgreSQL..."

gosu postgres pg_ctl \
    -D "$PGDATA" \
    -w start

# Gracefully stop PostgreSQL when the container receives SIGTERM/SIGINT
stop_pg() {
    echo "==> Stopping PostgreSQL..."
    gosu postgres pg_ctl -D "$PGDATA" -w stop -m fast
}
trap stop_pg TERM INT

echo "==> Configuring Redmine database..."

cat > "${REDMINE_DIR}/config/database.yml" <<EOF
production:
  adapter: postgresql
  database: ${POSTGRES_DB}
  host: 127.0.0.1
  port: 5432
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
