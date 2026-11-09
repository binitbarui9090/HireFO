#!/usr/bin/env bash
# Creates the two auxiliary databases the test suites use.
#
#   hirefo_test  → the API integration suite (it refuses any database whose name
#                  does not contain "test", since the suite truncates tables)
#   hirefo_e2e   → the Playwright journeys, so an e2e run never touches dev data
#
# Idempotent. Requires the compose datastores to be up (npm run infra:up).
set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-hirefo-postgres}"
USER_NAME="${POSTGRES_USER:-hirefo}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Postgres container '$CONTAINER' is not running. Start it with: npm run infra:up" >&2
  exit 1
fi

for db in hirefo_test hirefo_e2e; do
  if docker exec "$CONTAINER" psql -U "$USER_NAME" -d postgres -tAc \
       "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    echo "  $db already exists"
  else
    docker exec "$CONTAINER" psql -U "$USER_NAME" -d postgres -c "CREATE DATABASE $db" >/dev/null
    echo "  $db created"
  fi
done

echo
echo "Applying migrations to hirefo_test…"
# Routed through with-env.mjs so DATABASE_URL comes from .env.test.
( cd "$(dirname "${BASH_SOURCE[0]}")/.." \
  && HIREFO_ENV_FILE=.env.test node scripts/with-env.mjs \
       npm exec --workspace @hirefo/api -- prisma migrate deploy >/dev/null )
echo "  done"
echo
echo "Ready. Run: npm run test"
