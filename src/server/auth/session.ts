import { jwtVerify, SignJWT } from "jose";
import { RolUsuario } from "@prisma/client";

/**
 * Sesión = JWT HS256 en una cookie httpOnly.
 * El token identifica (sub, rol, sid, tok, iat, exp). `sid` es la fila de la
 * tabla Sesion (se puede revocar) y `tok` un secreto aleatorio cuyo hash está
 * en esa fila. Los permisos NO van en el token: se leen de la DB en cada
 * request, así un cambio aplica al instante.
 *
 * Este módulo no importa next/headers: lo usan el middleware (con
 * request/response explícitos) y el resto del servidor por igual.
 */

export const COOKIE_SESION = "session";
export const DURACION_SESION_S = 7 * 24 * 60 * 60; // 7 días
export const RENOVAR_SI_QUEDAN_S = 3 * 24 * 60 * 60; // renovación deslizante

const PLACEHOLDER_SECRET = "cambiar-por-un-secreto-largo-y-aleatorio-de-al-menos-32-caracteres";

export interface PayloadSesion {
  sub: string;
  rol: RolUsuario;
  sid: string;
  tok: string;
  iat: number;
  exp: number;
}

let secretCache: Uint8Array | undefined;

function secret(): Uint8Array {
  if (secretCache) return secretCache;
  const valor = process.env.AUTH_SECRET;
  if (!valor || valor.length < 32) {
    throw new Error(
      "AUTH_SECRET debe estar definido y tener al menos 32 caracteres (openssl rand -base64 32).",
    );
  }
  if (valor === PLACEHOLDER_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET sigue siendo el placeholder de .env.example: generá uno propio.");
  }
  secretCache = new TextEncoder().encode(valor);
  return secretCache;
}

export async function crearToken(usuario: {
  id: string;
  rol: RolUsuario;
  sid: string;
  tok: string;
}): Promise<string> {
  return new SignJWT({ rol: usuario.rol, sid: usuario.sid, tok: usuario.tok })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(usuario.id)
    .setIssuedAt()
    .setExpirationTime(`${DURACION_SESION_S}s`)
    .sign(secret());
}

/** Devuelve el payload si el token es válido y no venció; si no, null. */
export async function verificarToken(
  token: string | undefined | null,
): Promise<PayloadSesion | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const rol = payload.rol;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      typeof payload.tok !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      (rol !== RolUsuario.OWNER && rol !== RolUsuario.EMPLEADO)
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      rol,
      sid: payload.sid,
      tok: payload.tok,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

/** ¿Faltan menos de 3 días para que venza? => reemitir. */
export function debeRenovar(
  sesion: PayloadSesion,
  ahoraS = Math.floor(Date.now() / 1000),
): boolean {
  return sesion.exp - ahoraS < RENOVAR_SI_QUEDAN_S;
}

export function opcionesCookieSesion() {
  return {
    httpOnly: true,
    // En producción siempre https (NEXT_PUBLIC_APP_URL); COOKIE_INSEGURA=1 solo para probar el build en http local.
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_INSEGURA !== "1",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DURACION_SESION_S,
  };
}
