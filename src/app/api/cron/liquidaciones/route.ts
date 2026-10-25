import { NextResponse } from "next/server";

import { cronAutorizado } from "@/server/auth/cron";
import { cerrarMesesPendientes } from "@/server/services/ganancia-vendedor.service";
import { listarTodosLosPaneles } from "@/server/services/panel.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const paneles = (await listarTodosLosPaneles()).filter((p) => p.activo);
  return NextResponse.json({ ok: true, data: await cerrarMesesPendientes(paneles) });
}

export const GET = correr;
export const POST = correr;
