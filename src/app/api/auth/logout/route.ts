import { NextResponse } from "next/server";

import { esMismoOrigen, origenInvalido } from "@/server/auth/http";
import { metaDesdeHeaders } from "@/server/auth/request-meta";
import { COOKIE_SESION, verificarToken } from "@/server/auth/session";
import { revocarSesion } from "@/server/auth/sesiones";
import { registrarLogout } from "@/server/services/auth.service";

export const runtime = "nodejs";

/**
 * Solo POST (un GET de logout se puede disparar desde cualquier <img>).
 * Desde un <form> responde 303 a /login; desde fetch, JSON.
 */
export async function POST(req: Request) {
  if (!esMismoOrigen(req)) return origenInvalido();

  const cookie = req.headers
    .get("cookie")
    ?.match(new RegExp(`(?:^|;\\s*)${COOKIE_SESION}=([^;]+)`))?.[1];
  const sesion = await verificarToken(cookie);
  if (sesion) {
    await revocarSesion(sesion.sid, sesion.sub);
    await registrarLogout(sesion.sub, metaDesdeHeaders(req.headers));
  }

  const quiereJson = req.headers.get("accept")?.includes("application/json");
  const res = quiereJson
    ? NextResponse.json({ ok: true, data: null })
    : NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(COOKIE_SESION);
  return res;
}
