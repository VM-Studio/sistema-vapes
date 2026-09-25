#!/usr/bin/env bash
# Build de producción + servidor en :3457 contra una base descartable (E2E).
# Uso: scripts/reiniciar-verif.sh gestion_demo
set -euo pipefail
DB="${1:?base}"
pnpm -s build >/dev/null
lsof -ti:3457 | xargs kill 2>/dev/null || true
DATABASE_URL="postgresql://app:app@localhost:${DB_PORT:-5433}/$DB?schema=public" nohup pnpm start -p 3457 >"${TMPDIR:-/tmp}/verif-3457.log" 2>&1 &
for _ in $(seq 1 40); do curl -sf http://localhost:3457/api/health >/dev/null && exit 0; sleep 0.5; done
echo "El servidor no levantó" >&2; exit 1
