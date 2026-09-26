import { AccionAuditoria, Prisma, type RolUsuario } from "@prisma/client";

import { prisma, withTransaction } from "@/lib/db";
import { assertPasswordNoComun, hashPassword, verifyPassword } from "@/server/auth/password";
import type { RequestMeta } from "@/server/auth/request-meta";
import { NotFoundError, RateLimitError, UnauthorizedError, ValidationError } from "@/server/errors";
import { invalidarCacheSesiones } from "@/server/auth/sesiones";
import { registrarAuditoria } from "@/server/services/audit.service";

/** Máximo de intentos fallidos por email dentro de la ventana. */
export const MAX_INTENTOS_FALLIDOS = 5;
export const VENTANA_INTENTOS_MS = 15 * 60 * 1000;

export interface ResultadoLogin {
  id: string;
  rol: RolUsuario;
  debeCambiarPassword: boolean;
}

type Intento =
  | { tipo: "ok"; usuario: ResultadoLogin }
  | { tipo: "invalido" }
  | { tipo: "bloqueado"; reintentarEnSegundos: number };

/**
 * Autentica email + password con rate limit persistente (tabla IntentoLogin).
 *
 * - Máximo 5 intentos FALLIDOS por email en 15 minutos (contando desde el
 *   último login exitoso). El 6º se rechaza sin siquiera verificar la password.
 * - Un advisory lock por email serializa intentos concurrentes: 20 requests en
 *   paralelo no pueden "colarse" todos antes de que se cuenten los fallos.
 * - Mismo error y mismo tiempo de respuesta si el email no existe o la
 *   password es incorrecta.
 * - Los intentos bloqueados no se registran: el bloqueo vence 15 minutos
 *   después del 5º fallo aunque el atacante siga insistiendo.
 */
export async function autenticar(
  email: string,
  password: string,
  meta: RequestMeta,
): Promise<ResultadoLogin> {
  // El intento se registra SIEMPRE (commit), y recién después se lanza el error.
  const intento = await withTransaction<Intento>(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"login:" + email}))`;

      const ahora = Date.now();
      const desde = new Date(ahora - VENTANA_INTENTOS_MS);
      const ultimoExito = await tx.intentoLogin.findFirst({
        where: { email, exitoso: true, createdAt: { gte: desde } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const fallidos = await tx.intentoLogin.findMany({
        where: { email, exitoso: false, createdAt: { gt: ultimoExito?.createdAt ?? desde } },
        orderBy: { createdAt: "desc" },
        take: MAX_INTENTOS_FALLIDOS,
        select: { createdAt: true },
      });

      if (fallidos.length >= MAX_INTENTOS_FALLIDOS) {
        // Se libera cuando el más viejo de los 5 últimos fallos sale de la ventana.
        const masViejo = fallidos[MAX_INTENTOS_FALLIDOS - 1]!.createdAt.getTime();
        const segundos = Math.max(1, Math.ceil((masViejo + VENTANA_INTENTOS_MS - ahora) / 1000));
        return { tipo: "bloqueado", reintentarEnSegundos: segundos };
      }

      const usuario = await tx.usuario.findFirst({
        where: { email, activo: true, deletedAt: null },
        select: { id: true, rol: true, debeCambiarPassword: true, passwordHash: true },
      });
      const valido = await verifyPassword(password, usuario?.passwordHash);

      await tx.intentoLogin.create({ data: { email, ip: meta.ip, exitoso: valido } });
      if (!valido || !usuario) return { tipo: "invalido" };

      await tx.usuario.update({ where: { id: usuario.id }, data: { ultimoLogin: new Date() } });
      await registrarAuditoria(tx, {
        usuarioId: usuario.id,
        accion: AccionAuditoria.LOGIN,
        entidad: "Usuario",
        entidadId: usuario.id,
        meta,
      });
      return {
        tipo: "ok",
        usuario: {
          id: usuario.id,
          rol: usuario.rol,
          debeCambiarPassword: usuario.debeCambiarPassword,
        },
      };
    },
    // Read Committed alcanza: el advisory lock ya serializa por email, y
    // Serializable solo agregaría reintentos (con un bcrypt de ~250ms adentro).
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxRetries: 0 },
  );

  if (intento.tipo === "ok") return intento.usuario;
  if (intento.tipo === "bloqueado") {
    const minutos = Math.ceil(intento.reintentarEnSegundos / 60);
    throw new RateLimitError(
      `Demasiados intentos fallidos. Probá de nuevo en ${minutos} minuto${minutos === 1 ? "" : "s"}.`,
      intento.reintentarEnSegundos,
    );
  }
  throw new UnauthorizedError("Credenciales inválidas");
}

export async function registrarLogout(usuarioId: string, meta: RequestMeta): Promise<void> {
  await withTransaction(
    (tx) =>
      registrarAuditoria(tx, {
        usuarioId,
        accion: AccionAuditoria.LOGOUT,
        entidad: "Usuario",
        entidadId: usuarioId,
        meta,
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

/** Cambio de la propia contraseña (pide la actual). Limpia debeCambiarPassword. */
export async function cambiarPasswordPropia(
  usuarioId: string,
  input: { passwordActual: string; passwordNueva: string },
  meta: RequestMeta,
): Promise<void> {
  const usuario = await prisma.usuario.findFirst({
    where: { id: usuarioId, activo: true, deletedAt: null },
    select: { passwordHash: true },
  });
  if (!usuario) throw new NotFoundError("Usuario no encontrado");

  if (!(await verifyPassword(input.passwordActual, usuario.passwordHash))) {
    throw new ValidationError("La contraseña actual no es correcta", {
      passwordActual: ["La contraseña actual no es correcta"],
    });
  }

  await assertPasswordNoComun(input.passwordNueva, "passwordNueva");
  const passwordHash = await hashPassword(input.passwordNueva);
  await withTransaction(
    async (tx) => {
      await tx.usuario.update({
        where: { id: usuarioId },
        data: { passwordHash, debeCambiarPassword: false },
      });
      await registrarAuditoria(tx, {
        usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Usuario",
        entidadId: usuarioId,
        datosDespues: { cambio: "password", debeCambiarPassword: false },
        meta,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
  // El middleware tiene cacheado "debe cambiar la contraseña": que lo vea ya.
  invalidarCacheSesiones(usuarioId);
}
