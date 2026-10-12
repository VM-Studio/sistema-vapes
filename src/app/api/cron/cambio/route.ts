import { NextResponse } from "next/server";

import { cronAutorizado } from "@/server/auth/cron";
import { actualizarCotizaciones } from "@/server/services/cambio.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const resultados = await actualizarCotizaciones();
  return NextResponse.json({ ok: resultados.some((r) => r.ok), data: resultados });
}

export const GET = correr;
export const POST = correr;
