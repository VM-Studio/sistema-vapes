import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/version — versión del build que está sirviendo producción (pública,
 * sin datos). El cliente la compara con la suya (NEXT_PUBLIC_APP_VERSION) para
 * detectar que hay un deploy nuevo aunque la pestaña lleve horas abierta.
 */
export function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
