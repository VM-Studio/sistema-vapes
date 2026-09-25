import { NextResponse, type NextRequest } from "next/server";

import {
  COOKIE_SESION,
  crearToken,
  debeRenovar,
  opcionesCookieSesion,
  verificarToken,
} from "@/server/auth/session";
import { estadoSesion } from "@/server/services/sesion.service";

/**
 * Corre en cada request (salvo assets públicos, ver `matcher`):
 * 1. Verifica el JWT y que el usuario siga activo EN LA DB (desactivar a
 *    alguien corta su sesión en el próximo request, sin esperar a que venza).
 * 2. Con contraseña pendiente de cambio, solo deja usar /cuenta.
 * 3. Renovación deslizante: si faltan < 3 días, reemite la cookie.
 *
 * Runtime Node.js (estable desde Next 15.5) para poder consultar la DB con Prisma.
 */

const RUTAS_PUBLICAS = new Set(["/login", "/api/health", "/api/auth/login"]);
const PERMITIDAS_CON_CAMBIO_PENDIENTE = new Set(["/cuenta", "/api/auth/logout"]);

function esApi(pathname: string) {
  return pathname.startsWith("/api/");
}

function sinSesion(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const res = esApi(pathname)
    ? NextResponse.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Tenés que iniciar sesión" } },
        { status: 401 },
      )
    : NextResponse.redirect(
        new URL(
          pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname + search)}`,
          req.url,
        ),
      );
  if (req.cookies.has(COOKIE_SESION)) res.cookies.delete(COOKIE_SESION);
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const sesion = await verificarToken(req.cookies.get(COOKIE_SESION)?.value);
  const estado = sesion ? await estadoSesion(sesion.sub) : null;

  if (pathname === "/login") {
    // Ya logueado: no tiene sentido ver el login.
    if (estado)
      return NextResponse.redirect(new URL(estado.debeCambiarPassword ? "/cuenta" : "/", req.url));
    const res = NextResponse.next();
    if (req.cookies.has(COOKIE_SESION)) res.cookies.delete(COOKIE_SESION);
    return res;
  }
  if (RUTAS_PUBLICAS.has(pathname)) return NextResponse.next();
  // Archivos compartidos por link (PDF del comprobante por WhatsApp): clave inadivinable.
  if (pathname.startsWith("/api/publico/")) return NextResponse.next();
  // El cron no tiene sesión: se autentica con CRON_SECRET en su propia ruta.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  if (!sesion || !estado) return sinSesion(req);

  if (estado.debeCambiarPassword && !PERMITIDAS_CON_CAMBIO_PENDIENTE.has(pathname)) {
    return esApi(pathname)
      ? NextResponse.json(
          {
            ok: false,
            error: { code: "PASSWORD_CHANGE_REQUIRED", message: "Tenés que cambiar tu contraseña" },
          },
          { status: 403 },
        )
      : NextResponse.redirect(new URL("/cuenta", req.url));
  }

  const res = NextResponse.next();
  if (debeRenovar(sesion)) {
    res.cookies.set(
      COOKIE_SESION,
      await crearToken({ id: sesion.sub, rol: estado.rol }),
      opcionesCookieSesion(),
    );
  }
  return res;
}

export const config = {
  runtime: "nodejs",
  // Todo salvo assets estáticos, íconos, manifest y service worker.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|icons/|manifest.webmanifest|sw.js|offline.html|robots.txt).*)",
  ],
};
