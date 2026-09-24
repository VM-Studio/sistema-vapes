import { NextResponse } from "next/server";

import { loginSchema } from "@/lib/validations/usuario";
import { destinoSeguro, esMismoOrigen, mapearErrorHttp, origenInvalido } from "@/server/auth/http";
import { metaDesdeHeaders } from "@/server/auth/request-meta";
import { COOKIE_SESION, crearToken, opcionesCookieSesion } from "@/server/auth/session";
import { autenticar } from "@/server/services/auth.service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!esMismoOrigen(req)) return origenInvalido();
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const { email, password } = loginSchema.parse(body);
    const next =
      typeof body === "object" && body !== null && "next" in body ? body.next : undefined;

    const usuario = await autenticar(email, password, metaDesdeHeaders(req.headers));

    const res = NextResponse.json({
      ok: true,
      data: { redirectTo: usuario.debeCambiarPassword ? "/cuenta" : destinoSeguro(next) },
    });
    res.cookies.set(COOKIE_SESION, await crearToken(usuario), opcionesCookieSesion());
    return res;
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
