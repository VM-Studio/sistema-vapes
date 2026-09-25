import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { generarAlertas } from "@/server/services/notificacion.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Job diario de alertas (Vercel Cron o Railway cron). Protegido por
 * CRON_SECRET en el header: `Authorization: Bearer <secreto>` (lo que manda
 * Vercel Cron) o `x-cron-secret: <secreto>`. Sin secreto configurado, no corre.
 */
function autorizado(req: Request): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || secreto.length < 16) return false;
  const auth = req.headers.get("authorization");
  const recibido = auth?.startsWith("Bearer ") ? auth.slice(7) : req.headers.get("x-cron-secret");
  if (!recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(secreto);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function correr(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Secreto inválido" } },
      { status: 401 },
    );
  }
  try {
    return NextResponse.json({ ok: true, data: await generarAlertas() });
  } catch (e) {
    console.error("[cron/alertas]", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Falló el job" } },
      { status: 500 },
    );
  }
}

export const GET = correr;
export const POST = correr;
