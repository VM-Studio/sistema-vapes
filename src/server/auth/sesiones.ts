// Sin "server-only": lo importa el middleware (runtime Node, sin la condición react-server).
import { createHash, randomBytes } from "node:crypto";

import { AccionAuditoria, type RolUsuario } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { RequestMeta } from "@/server/auth/request-meta";
import { DURACION_SESION_S } from "@/server/auth/session";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * Sesiones revocables. El middleware llama a `validarSesion` en cada request:
 * el resultado se cachea 60 s en memoria por `sid` para no consultar la DB
 * siempre. Revocar, desactivar un usuario o cambiar su contraseña invalida el
 * caché de ESTA instancia al instante; otras instancias lo ven en ≤ 60 s.
 */

export interface EstadoSesion {
  usuarioId: string;
  rol: RolUsuario;
  debeCambiarPassword: boolean;
}

const TTL_MS = 60_000;
type EntradaCache = { t: number; estado: EstadoSesion | null; usuarioId: string | null };
// En globalThis: el middleware y las Server Actions son bundles distintos del
// MISMO proceso; con un Map de módulo, invalidar desde una acción no llegaría
// al middleware. (Entre instancias distintas, el TTL de 60 s acota el desfasaje.)
const global = globalThis as unknown as { __cacheSesiones?: Map<string, EntradaCache> };
const cache = (global.__cacheSesiones ??= new Map<string, EntradaCache>());

const hash = (tok: string) => createHash("sha256").update(tok).digest("hex");

export async function crearSesion(
  usuarioId: string,
  meta: RequestMeta,
): Promise<{ sid: string; tok: string }> {
  const tok = randomBytes(32).toString("base64url");
  const s = await prisma.sesion.create({
    data: {
      usuarioId,
      tokenHash: hash(tok),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiraAt: new Date(Date.now() + DURACION_SESION_S * 1000),
    },
  });
  return { sid: s.id, tok };
}

/** null = la sesión no existe, fue revocada, venció, o el usuario ya no puede entrar. */
export async function validarSesion(sid: string, tok: string): Promise<EstadoSesion | null> {
  const c = cache.get(sid);
  if (c && Date.now() - c.t < TTL_MS) return c.estado;
  const s = await prisma.sesion.findUnique({
    where: { id: sid },
    select: {
      tokenHash: true,
      revocadaAt: true,
      expiraAt: true,
      usuario: {
        select: { id: true, rol: true, debeCambiarPassword: true, activo: true, deletedAt: true },
      },
    },
  });
  const valida =
    s !== null &&
    s.tokenHash === hash(tok) &&
    s.revocadaAt === null &&
    s.expiraAt > new Date() &&
    s.usuario.activo &&
    s.usuario.deletedAt === null;
  const estado = valida
    ? {
        usuarioId: s.usuario.id,
        rol: s.usuario.rol,
        debeCambiarPassword: s.usuario.debeCambiarPassword,
      }
    : null;
  cache.set(sid, { t: Date.now(), estado, usuarioId: s?.usuario.id ?? null });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return estado;
}

/** Renovación deslizante: la fila acompaña al nuevo vencimiento del JWT. */
export async function extenderSesion(sid: string): Promise<void> {
  await prisma.sesion.updateMany({
    where: { id: sid, revocadaAt: null },
    data: { expiraAt: new Date(Date.now() + DURACION_SESION_S * 1000), ultimoUso: new Date() },
  });
}

/** Olvida lo cacheado (de un usuario, o todo). */
export function invalidarCacheSesiones(usuarioId?: string): void {
  if (!usuarioId) return cache.clear();
  for (const [sid, v] of cache) if (v.usuarioId === usuarioId) cache.delete(sid);
}

export async function revocarSesion(sid: string, porId: string | null): Promise<void> {
  const s = await prisma.sesion.findUnique({
    where: { id: sid },
    select: { usuarioId: true, revocadaAt: true },
  });
  if (!s || s.revocadaAt) return;
  await prisma.sesion.update({
    where: { id: sid },
    data: { revocadaAt: new Date(), revocadaPorId: porId },
  });
  cache.delete(sid);
}

/** "Cerrar sesión en todos los dispositivos" (o un dueño echando a un empleado). */
export async function revocarSesionesDeUsuario(
  usuarioId: string,
  por: { id: string; meta?: RequestMeta },
): Promise<number> {
  const r = await prisma.sesion.updateMany({
    where: { usuarioId, revocadaAt: null },
    data: { revocadaAt: new Date(), revocadaPorId: por.id },
  });
  invalidarCacheSesiones(usuarioId);
  await prisma.$transaction((tx) =>
    registrarAuditoria(tx, {
      usuarioId: por.id,
      accion: AccionAuditoria.SESION_REVOCADA,
      entidad: "Usuario",
      entidadId: usuarioId,
      datosDespues: { sesionesRevocadas: r.count },
      meta: por.meta,
    }),
  );
  return r.count;
}

export async function listarSesionesActivas(usuarioId: string) {
  return prisma.sesion.findMany({
    where: { usuarioId, revocadaAt: null, expiraAt: { gt: new Date() } },
    orderBy: { ultimoUso: "desc" },
    select: { id: true, ip: true, userAgent: true, createdAt: true, ultimoUso: true },
  });
}
