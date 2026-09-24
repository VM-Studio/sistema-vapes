import { NextResponse } from "next/server";

import { getHealth } from "@/server/services/health.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getHealth());
  } catch (error) {
    console.error("[health]", error);
    return NextResponse.json(
      { ok: false, db: "disconnected", error: "No se pudo conectar a la base de datos" },
      { status: 503 },
    );
  }
}
