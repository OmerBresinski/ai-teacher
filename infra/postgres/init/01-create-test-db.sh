#!/bin/bash
# Runs once, on first boot of an EMPTY volume (docker-entrypoint-initdb.d). To re-run it,
# recreate the volume: `bun run db:reset`.
#
# Creates the integration-test database and enables pgvector in BOTH databases so `@tj/db`
# migration 0000 can repeat `CREATE EXTENSION IF NOT EXISTS vector;` idempotently.
set -euo pipefail

TEST_DB="teaching_journey_test"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE ${TEST_DB};
  CREATE EXTENSION IF NOT EXISTS vector;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$TEST_DB" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS vector;
EOSQL

echo "init: created ${TEST_DB} and enabled pgvector in ${POSTGRES_DB} and ${TEST_DB}"
