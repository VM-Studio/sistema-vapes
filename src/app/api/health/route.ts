import { NextResponse } from "next/server";

import { log } from "@/server/log";
import { getHealth } from "@/server/services/health.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/health — healthcheck de la plataforma: 200 si la DB responde, 503 si no. */
export async function GET() {
  try {
    const h = await getHealth();
    return NextResponse.json(h, {
      status: h.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    log.error({ err: error }, "healthcheck falló");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
