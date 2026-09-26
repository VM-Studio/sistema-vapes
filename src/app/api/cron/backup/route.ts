import { NextResponse } from "next/server";

import { cronAutorizado } from "@/server/auth/cron";
import { hacerBackup } from "@/server/services/backup.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Backup por cron HTTP (Railway, un contenedor propio, cron-job.org…): corre
 * pg_dump donde exista. En Vercel (funciones sin pg_dump) el backup diario lo
 * hace GitHub Actions (.github/workflows/backup.yml) o Railway cron con `pnpm backup`.
 * Programación: 04:00 hora Argentina = 07:00 UTC.
 */
async function correr(req: Request) {
  if (!cronAutorizado(req)) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Secreto inválido" } },
      { status: 401 },
    );
  }
  const r = await hacerBackup("cron");
  return NextResponse.json(
    r.ok
      ? { ok: true, data: r }
      : { ok: false, error: { code: "BACKUP_FALLIDO", message: r.error } },
    { status: r.ok ? 200 : 500 },
  );
}

export const GET = correr;
export const POST = correr;
