import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { AccionAuditoria, Prisma, PropositoCodigo } from "@prisma/client";

import { obtenerEnv } from "@/env";
import { prisma, withTransaction } from "@/lib/db";
import { dispositivo } from "@/lib/dispositivo";
import { enmascararEmail } from "@/lib/password-fuerza";
import { formatearFechaHora } from "@/lib/utils";
import { assertPasswordNoComun, hashPassword, verifyPassword } from "@/server/auth/password";
import type { RequestMeta } from "@/server/auth/request-meta";
import { invalidarCacheSesiones } from "@/server/auth/sesiones";
import { DomainError, NotFoundError, RateLimitError, ValidationError } from "@/server/errors";
import { logger } from "@/server/log";
import { enviarMail, mailConfigurado, type EstadoEnvioMail } from "@/server/mail";
import { registrarAuditoria } from "@/server/services/audit.service";
import { nombreNegocio } from "@/server/services/identidad.service";

/**
 * Cambio de la propia contraseña con código por mail («Mi cuenta»):
 *
 *  1. `enviarCodigoCambioPassword`: código de 6 dígitos (crypto.randomInt) al
 *     email del usuario. Se guarda SOLO su HMAC-SHA256 con AUTH_SECRET como
 *     clave (pepper): una copia de la base no alcanza para probar los 10⁶
 *     códigos. Vence a los 10 minutos. Un código nuevo anula el anterior.
 *     Límites: 60 s entre envíos y 5 por hora (por usuario, en la DB).
 *  2. `verificarCodigo`: 5 intentos por código, un solo uso, solo desde la
 *     sesión que lo pidió. Si es correcto emite un token de verificación
 *     aleatorio (10 min) ligado al usuario y a la sesión (también guardado
 *     como HMAC) — el cliente no puede «saltar» al paso 3.
 *  3. `cambiarPasswordConToken`: consume el token, guarda el bcrypt, limpia
 *     debeCambiarPassword, revoca las OTRAS sesiones, audita y avisa por mail.
 *
 * Los intentos fallidos se registran (commit) ANTES de lanzar el error.
 */

export const DIGITOS_CODIGO = 6;
export const VIGENCIA_CODIGO_MS = 10 * 60_000;
export const MAX_INTENTOS_CODIGO = 5;
export const ESPERA_REENVIO_S = 60;
export const MAX_CODIGOS_POR_HORA = 5;
export const VIGENCIA_TOKEN_MS = 10 * 60_000;
/** Las filas se borran (perezosamente) un día después de vencer. */
const RETENCION_MS = 24 * 60 * 60_000;

const PROPOSITO = PropositoCodigo.CAMBIO_PASSWORD;

function hmac(...partes: string[]): string {
  return createHmac("sha256", obtenerEnv().AUTH_SECRET).update(partes.join(":")).digest("hex");
}

const hashCodigo = (usuarioId: string, codigo: string) =>
  hmac("codigo", PROPOSITO, usuarioId, codigo);
const hashToken = (usuarioId: string, sesionId: string, token: string) =>
  hmac("token", PROPOSITO, usuarioId, sesionId, token);

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "042917": uniforme en [0, 10⁶), con ceros a la izquierda. */
export function generarCodigo(): string {
  return String(randomInt(10 ** DIGITOS_CODIGO)).padStart(DIGITOS_CODIGO, "0");
}

const horaAR = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Limpieza perezosa: códigos vencidos hace más de un día (nunca falla la operación). */
export async function limpiarCodigosVencidos(ahora = Date.now()): Promise<number> {
  const r = await prisma.codigoVerificacion.deleteMany({
    where: { venceAt: { lt: new Date(ahora - RETENCION_MS) } },
  });
  return r.count;
}

// =============================================================================
// 1. Envío
// =============================================================================

export interface UsuarioCodigo {
  id: string;
  nombre: string;
  email: string;
}

export type ResultadoEnvioCodigo =
  | {
      estado: "ENVIADO";
      /** Email enmascarado («ju•••@gmail.com»). */
      para: string;
      venceAt: Date;
      reenviarEnSegundos: number;
    }
  | { estado: Exclude<EstadoEnvioMail, "ENVIADO"> };

function plantillaCodigo(
  negocio: string,
  nombre: string,
  codigo: string,
  venceAt: Date,
): { asunto: string; texto: string; html: string } {
  const hora = horaAR.format(venceAt);
  const minutos = VIGENCIA_CODIGO_MS / 60_000;
  const asunto = `${codigo} es tu código para cambiar la contraseña — ${negocio}`;
  const texto = [
    `Hola ${nombre}:`,
    "",
    `Pediste cambiar tu contraseña de ${negocio}. Tu código es:`,
    "",
    `    ${codigo}`,
    "",
    `Vence en ${minutos} minutos (a las ${hora}) y sirve una sola vez.`,
    "",
    "Si no fuiste vos, ignoralo: tu contraseña no cambia. Nadie del negocio te va a pedir este código.",
    "",
    negocio,
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#594A42;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6E625B;margin:0 0 16px">${escapar(negocio)}</p>
<h1 style="font-size:20px;margin:0 0 12px">Tu código para cambiar la contraseña</h1>
<p style="margin:0 0 16px">Hola ${escapar(nombre)}: pediste cambiar tu contraseña. Ingresá este código en «Mi cuenta»:</p>
<p style="font-family:'Courier New',monospace;font-size:34px;font-weight:bold;letter-spacing:10px;background:#F4EFEA;border-radius:12px;padding:16px 0;text-align:center;margin:0 0 16px">${escapar(codigo)}</p>
<p style="margin:0 0 24px">Vence en <strong>${minutos} minutos</strong> (a las ${escapar(hora)}) y sirve una sola vez.</p>
<p style="font-size:13px;color:#6E625B;border-top:1px solid #E6DED6;padding-top:16px;margin:0">Si no fuiste vos, ignoralo: tu contraseña no cambia. Nadie del negocio te va a pedir este código.</p>
</div>`;
  return { asunto, texto, html };
}

type Reserva =
  | { tipo: "ok"; id: string; codigo: string; venceAt: Date }
  | { tipo: "espera"; segundos: number }
  | { tipo: "hora"; segundos: number };

/**
 * Manda un código nuevo al email del usuario logueado. Lanza RateLimitError
 * si pidió otro hace menos de 60 s o ya pidió 5 en la última hora.
 */
export async function enviarCodigoCambioPassword(
  usuario: UsuarioCodigo,
  sesionId: string,
): Promise<ResultadoEnvioCodigo> {
  // Sin mail configurado no se crea nada (ni se gasta el límite).
  if (!mailConfigurado()) return { estado: "SIN_CONFIGURAR" };

  const reserva = await withTransaction<Reserva>(
    async (tx) => {
      // Serializa los pedidos del mismo usuario (dos clics, dos pestañas).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"codigo:" + usuario.id}))`;
      const ahora = Date.now();
      const recientes = await tx.codigoVerificacion.findMany({
        where: {
          usuarioId: usuario.id,
          proposito: PROPOSITO,
          createdAt: { gte: new Date(ahora - 60 * 60_000) },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const ultimo = recientes[0]?.createdAt.getTime();
      if (ultimo !== undefined && ahora - ultimo < ESPERA_REENVIO_S * 1000) {
        return {
          tipo: "espera",
          segundos: Math.ceil((ultimo + ESPERA_REENVIO_S * 1000 - ahora) / 1000),
        };
      }
      if (recientes.length >= MAX_CODIGOS_POR_HORA) {
        const masViejo = recientes[MAX_CODIGOS_POR_HORA - 1]!.createdAt.getTime();
        return { tipo: "hora", segundos: Math.ceil((masViejo + 60 * 60_000 - ahora) / 1000) };
      }
      // Un código nuevo anula los anteriores sin usar.
      await tx.codigoVerificacion.updateMany({
        where: { usuarioId: usuario.id, proposito: PROPOSITO, usadoAt: null },
        data: { usadoAt: new Date(ahora) },
      });
      const codigo = generarCodigo();
      const venceAt = new Date(ahora + VIGENCIA_CODIGO_MS);
      const fila = await tx.codigoVerificacion.create({
        data: {
          usuarioId: usuario.id,
          sesionId,
          proposito: PROPOSITO,
          codigoHash: hashCodigo(usuario.id, codigo),
          venceAt,
          createdAt: new Date(ahora),
        },
        select: { id: true },
      });
      return { tipo: "ok", id: fila.id, codigo, venceAt };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxRetries: 0 },
  );

  if (reserva.tipo === "espera") {
    throw new RateLimitError(
      `Esperá ${reserva.segundos} segundo${reserva.segundos === 1 ? "" : "s"} para pedir otro código.`,
      reserva.segundos,
    );
  }
  if (reserva.tipo === "hora") {
    const min = Math.max(1, Math.ceil(reserva.segundos / 60));
    throw new RateLimitError(
      `Pediste demasiados códigos. Probá de nuevo en ${min} minuto${min === 1 ? "" : "s"}.`,
      reserva.segundos,
    );
  }

  void limpiarCodigosVencidos().catch(() => {});

  const negocio = await nombreNegocio();
  const mail = plantillaCodigo(negocio, usuario.nombre, reserva.codigo, reserva.venceAt);
  const r = await enviarMail({ para: [usuario.email], ...mail }, negocio);
  if (r.estado !== "ENVIADO") {
    // El código no llegó: queda anulado (pero cuenta para el límite).
    await prisma.codigoVerificacion.update({
      where: { id: reserva.id },
      data: { usadoAt: new Date() },
    });
    if (r.estado === "ERROR")
      logger().warn({ usuarioId: usuario.id, detalle: r.detalle }, "codigo: mail no enviado");
    return { estado: r.estado };
  }
  return {
    estado: "ENVIADO",
    para: enmascararEmail(usuario.email),
    venceAt: reserva.venceAt,
    reenviarEnSegundos: ESPERA_REENVIO_S,
  };
}

// =============================================================================
// 2. Verificación
// =============================================================================

type Verificacion =
  | { tipo: "ok"; token: string; venceAt: Date }
  | { tipo: "sin_codigo" | "vencido" | "agotado" }
  | { tipo: "incorrecto"; quedan: number };

const errorCodigo = (mensaje: string, code = "CODIGO_INVALIDO") =>
  new DomainError(mensaje, code, 422, { codigo: [mensaje] });

/**
 * Valida el código (de esta sesión). Correcto → token de verificación para
 * el paso «contraseña nueva». Incorrecto → suma un intento (máximo 5).
 */
export async function verificarCodigo(
  usuarioId: string,
  sesionId: string,
  codigo: string,
): Promise<{ token: string; venceAt: Date }> {
  const r = await withTransaction<Verificacion>(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"codigo:" + usuarioId}))`;
      const ahora = Date.now();
      const fila = await tx.codigoVerificacion.findFirst({
        where: { usuarioId, sesionId, proposito: PROPOSITO, usadoAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, codigoHash: true, venceAt: true, intentos: true },
      });
      if (!fila) return { tipo: "sin_codigo" };
      if (fila.venceAt.getTime() <= ahora) return { tipo: "vencido" };
      if (fila.intentos >= MAX_INTENTOS_CODIGO) return { tipo: "agotado" };
      if (!iguales(fila.codigoHash, hashCodigo(usuarioId, codigo))) {
        const intentos = fila.intentos + 1;
        await tx.codigoVerificacion.update({ where: { id: fila.id }, data: { intentos } });
        return { tipo: "incorrecto", quedan: MAX_INTENTOS_CODIGO - intentos };
      }
      const token = randomBytes(32).toString("base64url");
      const venceAt = new Date(ahora + VIGENCIA_TOKEN_MS);
      await tx.codigoVerificacion.update({
        where: { id: fila.id },
        data: {
          usadoAt: new Date(ahora),
          tokenHash: hashToken(usuarioId, sesionId, token),
          tokenVenceAt: venceAt,
        },
      });
      return { tipo: "ok", token, venceAt };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxRetries: 0 },
  );

  switch (r.tipo) {
    case "ok":
      return { token: r.token, venceAt: r.venceAt };
    case "sin_codigo":
      throw errorCodigo("Ese código ya no sirve. Pedí uno nuevo.", "CODIGO_NUEVO");
    case "vencido":
      throw errorCodigo("El código venció. Pedí uno nuevo.", "CODIGO_NUEVO");
    case "agotado":
      throw errorCodigo("Demasiados intentos con este código. Pedí uno nuevo.", "CODIGO_NUEVO");
    case "incorrecto":
      if (r.quedan === 0)
        throw errorCodigo(
          "El código no es correcto y ya no quedan intentos. Pedí uno nuevo.",
          "CODIGO_NUEVO",
        );
      throw errorCodigo(
        `El código no es correcto. Te ${r.quedan === 1 ? "queda 1 intento" : `quedan ${r.quedan} intentos`}.`,
      );
  }
}

// =============================================================================
// 3. Contraseña nueva
// =============================================================================

export interface PasswordCambiada {
  /** Tenía el cambio obligatorio: ahora puede entrar al resto del sistema. */
  habilitado: boolean;
  sesionesCerradas: number;
  aviso: EstadoEnvioMail;
}

/** Error que manda al usuario de vuelta al paso 1. */
export const VERIFICACION_VENCIDA = "VERIFICACION_VENCIDA";

export async function cambiarPasswordConToken(
  usuarioId: string,
  sesionId: string,
  input: { token: string; passwordNueva: string },
  meta: RequestMeta,
): Promise<PasswordCambiada> {
  const tokenHash = hashToken(usuarioId, sesionId, input.token);
  const vigente = () => ({
    usuarioId,
    sesionId,
    proposito: PROPOSITO,
    tokenHash,
    tokenUsadoAt: null,
    tokenVenceAt: { gt: new Date() },
  });
  const vencida = () =>
    new DomainError(
      "La verificación venció o ya se usó. Pedí un código nuevo.",
      VERIFICACION_VENCIDA,
      422,
    );

  // Primero el token (no gastar bcrypt con uno inválido), después la contraseña.
  if (!(await prisma.codigoVerificacion.findFirst({ where: vigente(), select: { id: true } })))
    throw vencida();

  const usuario = await prisma.usuario.findFirst({
    where: { id: usuarioId, activo: true, deletedAt: null },
    select: { nombre: true, email: true, passwordHash: true, debeCambiarPassword: true },
  });
  if (!usuario) throw new NotFoundError("Usuario no encontrado");
  await assertPasswordNoComun(input.passwordNueva, "passwordNueva");
  if (await verifyPassword(input.passwordNueva, usuario.passwordHash)) {
    throw new ValidationError("La nueva contraseña debe ser distinta de la actual", {
      passwordNueva: ["Tiene que ser distinta de la actual"],
    });
  }
  const passwordHash = await hashPassword(input.passwordNueva);

  const sesionesCerradas = await withTransaction(
    async (tx) => {
      // Consumo atómico: dos envíos simultáneos con el mismo token → uno solo pasa.
      const consumo = await tx.codigoVerificacion.updateMany({
        where: vigente(),
        data: { tokenUsadoAt: new Date() },
      });
      if (consumo.count !== 1) throw vencida();
      await tx.usuario.update({
        where: { id: usuarioId },
        data: { passwordHash, debeCambiarPassword: false },
      });
      // Las otras sesiones se cierran; la actual sigue.
      const r = await tx.sesion.updateMany({
        where: { usuarioId, revocadaAt: null, id: { not: sesionId } },
        data: { revocadaAt: new Date(), revocadaPorId: usuarioId },
      });
      await registrarAuditoria(tx, {
        usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Usuario",
        entidadId: usuarioId,
        datosAntes: { debeCambiarPassword: usuario.debeCambiarPassword },
        datosDespues: {
          cambio: "password",
          metodo: "codigo_mail",
          debeCambiarPassword: false,
          sesionesRevocadas: r.count,
        },
        meta,
      });
      return r.count;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxRetries: 0 },
  );
  // El middleware tiene cacheadas las sesiones (y el "debe cambiar"): que lo vea ya.
  invalidarCacheSesiones(usuarioId);

  const aviso = await avisarPasswordCambiada(usuario, meta);
  return { habilitado: usuario.debeCambiarPassword, sesionesCerradas, aviso };
}

/** Mail «tu contraseña se cambió» (nunca falla el cambio). */
async function avisarPasswordCambiada(
  usuario: { nombre: string; email: string },
  meta: RequestMeta,
): Promise<EstadoEnvioMail> {
  try {
    const negocio = await nombreNegocio();
    const cuando = formatearFechaHora(new Date());
    const desde = `${dispositivo(meta.userAgent)}${meta.ip ? ` (IP ${meta.ip})` : ""}`;
    const asunto = `Tu contraseña de ${negocio} se cambió`;
    const texto = [
      `Hola ${usuario.nombre}:`,
      "",
      `Tu contraseña de ${negocio} se cambió el ${cuando} desde ${desde}.`,
      "Por seguridad cerramos tus sesiones en los otros dispositivos.",
      "",
      "Si fuiste vos, no tenés que hacer nada.",
      "Si NO fuiste vos, avisale ya a un dueño para que te resetee la contraseña desde Usuarios.",
      "",
      negocio,
    ].join("\n");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#594A42;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6E625B;margin:0 0 16px">${escapar(negocio)}</p>
<h1 style="font-size:20px;margin:0 0 12px">Tu contraseña se cambió</h1>
<p style="margin:0 0 12px">Hola ${escapar(usuario.nombre)}: tu contraseña se cambió el <strong>${escapar(cuando)}</strong> desde ${escapar(desde)}.</p>
<p style="margin:0 0 24px">Por seguridad cerramos tus sesiones en los otros dispositivos. Si fuiste vos, no tenés que hacer nada.</p>
<p style="font-size:14px;background:#FBEDEA;color:#8A2D1F;border-radius:12px;padding:12px 16px;margin:0"><strong>¿No fuiste vos?</strong> Avisale ya a un dueño para que te resetee la contraseña desde Usuarios.</p>
</div>`;
    return (await enviarMail({ para: [usuario.email], asunto, texto, html }, negocio)).estado;
  } catch (error) {
    logger().warn({ err: error }, "codigo: no se pudo avisar el cambio de contraseña");
    return "ERROR";
  }
}
