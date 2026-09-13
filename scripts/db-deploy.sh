#!/usr/bin/env bash
# Deploys schema, then types, then procedures, then seed. Idempotent and re-runnable.
# There are NO direct production database edits — every change goes through this script.
set -euo pipefail

SERVER="${AKRHO_SQL_SERVER:-localhost,1433}"
USER="${AKRHO_SQL_USER:-sa}"
PASS="${AKRHO_SQL_PASSWORD:-Your_password123}"
DB="${AKRHO_DB:-Akrho}"
SEED="${AKRHO_SEED:-1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sql() { sqlcmd -S "$SERVER" -U "$USER" -P "$PASS" -C -b "$@"; }

echo "→ ensuring database $DB"
sql -Q "IF DB_ID('$DB') IS NULL CREATE DATABASE [$DB];"

run_dir() {
  local dir="$1" label="$2"
  echo "→ $label"
  for f in $(ls "$ROOT/db/$dir"/*.sql | sort); do
    echo "   $(basename "$f")"
    sql -d "$DB" -i "$f"
  done
}

run_dir schema "schema"
echo "→ types"
sql -d "$DB" -i "$ROOT/db/procs/00_types.sql"
echo "→ procedures"
for f in $(ls "$ROOT/db/procs"/usp_*.sql | sort); do
  echo "   $(basename "$f")"
  sql -d "$DB" -i "$f"
done

if [ "$SEED" = "1" ]; then
  run_dir seed "seed (reference + demo — never run 02_demo_chapter in production)"
fi

echo "✓ database deployed"
