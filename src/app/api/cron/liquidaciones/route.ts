import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { cronAutorizado } from "@/server/auth/cron";
import { cerrarMesesPendientes } from "@/server/services/ganancia-vendedor.service";
import { listarTodosLosPaneles } from "@/server/services/panel.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Monitor de Sentry (se crea solo con el primer check-in; horario en UTC, igual que vercel.json). */
const MONITOR = {
  schedule: { type: "crontab" as const, value: "10 3 1 * *" },
  checkinMargin: 30,
  maxRuntime: 5,
  timezone: "Etc/UTC",
};

/**
 * Cierre de mes de la ganancia por vape: genera las liquidaciones de los
 * vendedores con tarifas para los meses terminados que falten (idempotente).
 * Programado el día 1 a las 00:10 de Argentina (vercel.json); además, cada
 * pantalla que muestra la ganancia cierra lo que falte al abrirse.
 */
async function correr(req: Request) {
  if (!cronAutorizado(req)) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Secreto inválido" } },
      { status: 401 },
    );
  }
  // Sentry avisa si el cierre de mes no corre o falla.
  const data = await Sentry.withMonitor(
    "cron-liquidaciones",
    async () => {
      const paneles = (await listarTodosLosPaneles()).filter((p) => p.activo);
      return cerrarMesesPendientes(paneles);
    },
    MONITOR,
  );
  return NextResponse.json({ ok: true, data });
}

export const GET = correr;
export const POST = correr;
