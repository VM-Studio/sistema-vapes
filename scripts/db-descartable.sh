#!/usr/bin/env bash
# Recrea una base DESCARTABLE (nunca la de desarrollo) con migraciones + seed.
# Uso: scripts/db-descartable.sh gestion_test [--demo]
set -euo pipefail
DB="${1:?nombre de la base descartable}"
case "$DB" in gestion) echo "Esta es la base de desarrollo: no se recrea." >&2; exit 1 ;; esac
docker exec sistema_vapes_db psql -U app -d postgres -qc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
export DATABASE_URL="postgresql://app:app@localhost:${DB_PORT:-5433}/$DB?schema=public"
export DIRECT_URL="$DATABASE_URL"
npx prisma migrate deploy >/dev/null
PRISMA_LOG=silent npx tsx prisma/seed.ts
if [ "${2:-}" = "--demo" ]; then PRISMA_LOG=silent LOG_LEVEL="${LOG_LEVEL:-warn}" npx tsx --conditions=react-server prisma/seed-demo.ts; fi
