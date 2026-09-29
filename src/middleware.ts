import { NextResponse, type NextRequest } from "next/server";

import { construirCsp } from "@/server/seguridad/csp";
import { consumir } from "@/server/seguridad/rate-limit";
import {
  COOKIE_SESION,
  crearToken,
  debeRenovar,
  opcionesCookieSesion,
  verificarToken,
} from "@/server/auth/session";
import { panelPorSlug, slugDeRuta } from "@/server/auth/paneles-acceso";
import { extenderSesion, validarSesion } from "@/server/auth/sesiones";

/**
 * Corre en cada request (salvo assets estáticos, ver `matcher`):
 * 1. requestId (x-request-id) y CSP con nonce por request (Next lo aplica a sus scripts).
 * 2. Mutaciones (POST/PUT/PATCH/DELETE) con Origin de otro sitio → 403.
 * 3. Rate limit de /api/* y Server Actions: por usuario (o IP si no hay sesión).
 * 4. Sesión: JWT válido + fila Sesion no revocada ni vencida + usuario activo
 *    (consulta cacheada 60 s por sid). Revocar corta el acceso al instante.
 * 5. Con contraseña pendiente de cambio, solo deja usar /cuenta.
 * 6. /p/{slug}/* (y /api/p/{slug}/*): el panel existe, está activo y el
 *    usuario accede (OWNER o fila en UsuarioPanel); si no → /paneles con aviso.
 *    Pasa el panel resuelto a la app en x-panel-id / x-panel-slug.
 * 7. Renovación deslizante del JWT y de la sesión.
 *
 * Runtime Node.js (estable desde Next 15.5) para poder consultar la DB con Prisma.
 */

const RUTAS_PUBLICAS = new Set(["/login", "/api/health", "/api/auth/login", "/offline"]);
const PREFIJOS_PUBLICOS = ["/api/publico/", "/api/cron/", "/serwist/"];
const PERMITIDAS_CON_CAMBIO_PENDIENTE = new Set(["/cuenta", "/api/auth/logout"]);
const MUTACIONES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const esApi = (pathname: string) => pathname.startsWith("/api/");

function origenesPermitidos(req: NextRequest): Set<string> {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const permitidos = new Set<string>();
  if (host) permitidos.add(host);
  const app = process.env.NEXT_PUBLIC_APP_URL;
  if (app) {
    try {
      permitidos.add(new URL(app).host);
    } catch {
      /* env.ts ya valida la URL al arrancar */
    }
  }
  return permitidos;
}

/** Sin Origin (curl, cron) se deja pasar: la protección CSRF es para navegadores, que siempre lo mandan en mutaciones. */
function origenAjeno(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return !origenesPermitidos(req).has(new URL(origin).host);
  } catch {
    return true;
  }
}

function json(status: number, code: string, message: string, extra?: Record<string, string>) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status, headers: extra });
}

function sinSesion(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const res = esApi(pathname)
    ? json(401, "UNAUTHORIZED", "Tenés que iniciar sesión")
    : NextResponse.redirect(
        new URL(
          pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname + search)}`,
          req.url,
        ),
      );
  if (req.cookies.has(COOKIE_SESION)) res.cookies.delete(COOKIE_SESION);
  return res;
}

function ipDe(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const dev = process.env.NODE_ENV !== "production";
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = construirCsp({
    nonce,
    dev,
    storage: [process.env.S3_PUBLIC_URL, process.env.S3_ENDPOINT].filter((x): x is string =>
      Boolean(x),
    ),
    https: process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://") ?? false,
  });

  const cabeceras = new Headers(req.headers);
  cabeceras.set("x-request-id", requestId);
  cabeceras.set("x-nonce", nonce);
  cabeceras.set("x-pathname", pathname);
  cabeceras.set("content-security-policy", csp);
  // Solo el middleware define el panel: lo que mande el cliente se descarta.
  cabeceras.delete("x-panel-id");
  cabeceras.delete("x-panel-slug");
  const seguir = () => {
    const r = NextResponse.next({ request: { headers: cabeceras } });
    r.headers.set("content-security-policy", csp);
    r.headers.set("x-request-id", requestId);
    return r;
  };

  // 2. CSRF: una mutación desde otro sitio no llega a ningún handler ni Server Action.
  if (MUTACIONES.has(req.method) && origenAjeno(req)) {
    return json(403, "FORBIDDEN", "Origen no permitido");
  }

  const esAction = req.method === "POST" && req.headers.has("next-action");
  const publica =
    RUTAS_PUBLICAS.has(pathname) || PREFIJOS_PUBLICOS.some((p) => pathname.startsWith(p));
  const sesion = await verificarToken(req.cookies.get(COOKIE_SESION)?.value);
  const estado = sesion ? await validarSesion(sesion.sid, sesion.tok) : null;

  // 3. Rate limit (el login tiene además el suyo, por email).
  if (
    (esApi(pathname) || esAction) &&
    pathname !== "/api/health" &&
    !pathname.startsWith("/api/cron/")
  ) {
    const limite = Number(process.env.RATE_LIMIT_POR_MINUTO ?? 300);
    const clave = estado ? `u:${estado.usuarioId}` : `ip:${ipDe(req)}`;
    const r = await consumir(clave, estado ? limite : Math.max(30, Math.floor(limite / 3)));
    if (!r.permitido) {
      return json(429, "RATE_LIMITED", "Demasiadas solicitudes: esperá un momento.", {
        "Retry-After": String(r.reintentarEnSegundos),
      });
    }
  }

  if (pathname === "/login") {
    // Ya logueado: no tiene sentido ver el login.
    if (estado)
      return NextResponse.redirect(new URL(estado.debeCambiarPassword ? "/cuenta" : "/", req.url));
    const res = seguir();
    if (req.cookies.has(COOKIE_SESION)) res.cookies.delete(COOKIE_SESION);
    return res;
  }
  if (publica) return seguir();

  if (!sesion || !estado || estado.usuarioId !== sesion.sub) return sinSesion(req);

  if (estado.debeCambiarPassword && !PERMITIDAS_CON_CAMBIO_PENDIENTE.has(pathname)) {
    return esApi(pathname)
      ? json(403, "PASSWORD_CHANGE_REQUIRED", "Tenés que cambiar tu contraseña")
      : NextResponse.redirect(new URL("/cuenta", req.url));
  }

  // 6. Panel: existe, activo y el usuario accede.
  const slug = slugDeRuta(pathname);
  if (slug) {
    const panel = await panelPorSlug(slug);
    const accede = panel && (estado.rol === "OWNER" || estado.paneles.includes(panel.id));
    if (!panel || !accede) {
      return esApi(pathname) || esAction
        ? json(403, "FORBIDDEN", "No tenés acceso a ese panel")
        : NextResponse.redirect(new URL("/paneles?aviso=sin-acceso", req.url));
    }
    cabeceras.set("x-panel-id", panel.id);
    cabeceras.set("x-panel-slug", panel.slug);
  }

  const res = seguir();
  if (debeRenovar(sesion)) {
    await extenderSesion(sesion.sid);
    res.cookies.set(
      COOKIE_SESION,
      await crearToken({ id: sesion.sub, rol: estado.rol, sid: sesion.sid, tok: sesion.tok }),
      opcionesCookieSesion(),
    );
  }
  return res;
}

export const config = {
  runtime: "nodejs",
  // Todo salvo assets estáticos, íconos, imagen Open Graph, manifest y el service worker.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|icons/|splash/|screenshots/|opengraph-image|manifest.webmanifest|robots.txt|ayuda-img/|brand/|portadaApp.png|logoVape.png|logoCosmetics.png|logoEspecial.png).*)",
  ],
};
