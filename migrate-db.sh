#!/bin/bash
set -e

# Migration script: PG 15 (redmine-pgdata) → PG 16 (redmine-ai_redmine-pgdata)
# Preserves the old volume intact.

echo "=== Redmine DB Migration: PG 15 → PG 16 ==="

# Make sure compose is stopped
echo "==> Stopping compose stack..."
podman compose down 2>/dev/null || true

# Cleanup any leftover temp containers
podman rm -f pg-migrate-src pg-migrate-dst 2>/dev/null || true
podman network rm redmine-migrate 2>/dev/null || true

# Create temp network
podman network create redmine-migrate

# Start old PG 15 from redmine-pgdata volume (source)
echo "==> Starting source PG 15 from redmine-pgdata..."
podman run -d \
  --name pg-migrate-src \
  --network redmine-migrate \
  -v redmine-pgdata:/var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:15

sleep 5

# Start fresh PG 16 in redmine-ai_redmine-pgdata volume (destination)
echo "==> Starting destination PG 16 in redmine-ai_redmine-pgdata..."
podman run -d \
  --name pg-migrate-dst \
  --network redmine-migrate \
  -v redmine-ai_redmine-pgdata:/var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:16

sleep 5

# Dump from source and restore to destination
echo "==> Migrating data via pg_dump/psql..."
podman exec pg-migrate-src pg_dump -U redmine -d redmine -Fc \
  --no-owner --no-privileges --clean --if-exists | \
  podman exec -i pg-migrate-dst pg_restore -U redmine -d redmine --clean --if-exists --no-owner --no-privileges

# Verify the migrated data
echo "==> Verifying migrated data..."
podman exec pg-migrate-dst psql -U redmine -d redmine -c '
  SELECT count(*) as users FROM users;
  SELECT count(*) as projects FROM projects;
  SELECT count(*) as issues FROM issues;
  SELECT count(*) as wiki_pages FROM wiki_pages;
  SELECT count(*) as journals FROM journals;
  SELECT count(*) as attachments FROM attachments;
  SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;
'

# Check that old volume is untouched
echo "==> Verifying old volume is intact..."
podman exec pg-migrate-src psql -U redmine -d redmine -c '
  SELECT count(*) as users FROM users;
  SELECT count(*) as issues FROM issues;
'

# Insert migration versions for Redmine 7.0+ features that weren't in the old data.
# Old PG data has numeric versions up to 99. New Redmine versions use timestamp-based
# migration names. We mark them as applied so Rails won't try to re-run them.
echo "==> Syncing Redmine 7.0+ migration versions..."
podman exec pg-migrate-dst psql -U redmine -d redmine -c "
  INSERT INTO schema_migrations (version)
  SELECT * FROM (VALUES
    ('20251007073256')
  ) AS t(version)
  WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '20251007073256');
"
echo "    Migration sync complete."

# Cleanup temp containers
echo "==> Cleaning up..."
podman stop pg-migrate-src pg-migrate-dst
podman rm pg-migrate-src pg-migrate-dst
podman network rm redmine-migrate

echo "==> Migration complete!"
echo "    Old volume (redmine-pgdata): preserved"
echo "    New volume (redmine-ai_redmine-pgdata): migrated data"
