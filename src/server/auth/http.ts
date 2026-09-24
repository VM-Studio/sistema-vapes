import { NextResponse } from "next/server";

import { mapearErrorHttp } from "@/server/auth/http-errors";

/**
 * Defensa CSRF para Route Handlers que cambian estado: el Origin (o Referer)
 * tiene que ser este mismo host. (Las Server Actions ya lo verifican solas.)
 */
export function esMismoOrigen(req: Request): boolean {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origen = req.headers.get("origin") ?? req.headers.get("referer");
  if (!host || !origen) return false;
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

export function origenInvalido() {
  return NextResponse.json(
    { ok: false, error: { code: "FORBIDDEN", message: "Origen no permitido" } },
    { status: 403 },
  );
}

/** Solo rutas internas: evita redirecciones abiertas (?next=https://malicioso). */
export function destinoSeguro(next: unknown, porDefecto = "/"): string {
  if (
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return porDefecto;
  }
  return next;
}

export { mapearErrorHttp };
