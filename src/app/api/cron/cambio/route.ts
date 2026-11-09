import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { cronAutorizado } from "@/server/auth/cron";
import { actualizarCotizaciones } from "@/server/services/cambio.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Monitor de Sentry (se crea solo con el primer check-in; horario en UTC, igual que vercel.json). */
const MONITOR = {
  schedule: { type: "crontab" as const, value: "0 12 * * *" },
  checkinMargin: 30,
  maxRuntime: 5,
  timezone: "Etc/UTC",
};

/**
 * Actualiza las cotizaciones (dólar blue y USDT) desde las fuentes públicas.
 * Programado cada 15 min donde el plan lo permita (vercel.json, Railway,
 * cron-job.org…); además, cualquier lectura con la cotización vieja la
 * refresca en segundo plano (ver cambio.service). 200 aunque alguna moneda
 * falle (queda la última válida): el detalle va en `data`.
 */
async function correr(req: Request) {
  if (!cronAutorizado(req)) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Secreto inválido" } },
      { status: 401 },
    );
  }
  // Sentry avisa si el cron no corre en el día o si fallan todas las monedas.
  const resultados = await Sentry.withMonitor(
    "cron-cotizaciones",
    async () => {
      const r = await actualizarCotizaciones();
      if (!r.some((x) => x.ok)) throw new Error("No se pudo actualizar ninguna cotización");
      return r;
    },
    MONITOR,
  ).catch(() => null);
  if (!resultados) return NextResponse.json({ ok: false, data: [] }, { status: 502 });
  return NextResponse.json({ ok: resultados.some((r) => r.ok), data: resultados });
}

export const GET = correr;
export const POST = correr;
