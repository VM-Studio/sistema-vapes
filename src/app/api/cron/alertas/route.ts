import { NextResponse } from "next/server";

import { cronAutorizado } from "@/server/auth/cron";
import { log } from "@/server/log";
import { verificarBackupReciente } from "@/server/services/backup.service";
import { generarAlertas } from "@/server/services/notificacion.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Job diario de alertas (stock, cajas, transferencias, deudas) + control de que haya backup en 36 h. */
async function correr(req: Request) {
  if (!cronAutorizado(req)) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Secreto inválido" } },
      { status: 401 },
    );
  }
  try {
    const [alertas, backup] = await Promise.all([generarAlertas(), verificarBackupReciente()]);
    return NextResponse.json({ ok: true, data: { ...alertas, backupReciente: backup.ok } });
  } catch (e) {
    log.error({ err: e }, "falló el job de alertas");
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Falló el job" } },
      { status: 500 },
    );
  }
}

export const GET = correr;
export const POST = correr;
