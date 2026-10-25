import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import nodemailer, { type Transporter } from "nodemailer";

import { obtenerEnv } from "@/env";
import { logger } from "@/server/log";

/**
 * Envío de mails (remitos de pago de las liquidaciones).
 *
 * - `MAIL_TRANSPORTE=gmail` (default): SMTP de Gmail (smtp.gmail.com:465,
 *   TLS) con GMAIL_USER y una contraseña de aplicación (GMAIL_APP_PASSWORD).
 *   Sin las dos variables NO se intenta nada: el resultado es SIN_CONFIGURAR
 *   y quien llama ofrece el link por WhatsApp.
 * - `MAIL_TRANSPORTE=prueba`: no sale nada; cada mail (con adjuntos) se
 *   guarda como JSON en MAIL_PRUEBA_DIR (E2E y desarrollo).
 * - `fijarTransporteMail()`: los tests inyectan un transporte de nodemailer
 *   (jsonTransport / streamTransport).
 *
 * Nunca lanza: un error de SMTP vuelve como `ERROR` con el detalle (el pago
 * ya quedó registrado; el envío se puede reintentar).
 */

export type EstadoEnvioMail = "ENVIADO" | "SIN_CONFIGURAR" | "ERROR";

export interface ResultadoMail {
  estado: EstadoEnvioMail;
  detalle: string | null;
  messageId: string | null;
}

export interface MailSaliente {
  para: string[];
  asunto: string;
  texto: string;
  html?: string;
  responderA?: string;
  adjuntos?: { nombre: string; contenido: Uint8Array; tipo: string }[];
}

let transporteFijo: Transporter | null = null;

/** Solo tests: transporte de nodemailer a usar (null = el del entorno). */
export function fijarTransporteMail(t: Transporter | null): void {
  transporteFijo = t;
}

/** ¿Se pueden mandar mails de verdad (o de prueba)? */
export function mailConfigurado(): boolean {
  const e = obtenerEnv();
  return (
    transporteFijo !== null ||
    e.MAIL_TRANSPORTE === "prueba" ||
    Boolean(e.GMAIL_USER && e.GMAIL_APP_PASSWORD)
  );
}

/** Casilla(s) de los dueños para el remito firmado: MAIL_DUENOS o, si falta, GMAIL_USER. */
export function mailsDuenos(): string[] {
  const e = obtenerEnv();
  return e.MAIL_DUENOS ?? (e.GMAIL_USER ? [e.GMAIL_USER] : []);
}

let gmail: Transporter | null = null;

function transporte(): Transporter | null {
  if (transporteFijo) return transporteFijo;
  const e = obtenerEnv();
  if (e.MAIL_TRANSPORTE === "prueba") return nodemailer.createTransport({ jsonTransport: true });
  if (!e.GMAIL_USER || !e.GMAIL_APP_PASSWORD) return null;
  gmail ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: e.GMAIL_USER, pass: e.GMAIL_APP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return gmail;
}

const comillas = (s: string) => `"${s.replace(/["\\\r\n]/g, "")}"`;

export async function enviarMail(m: MailSaliente, nombreRemitente: string): Promise<ResultadoMail> {
  const e = obtenerEnv();
  const para = [...new Set(m.para.map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (para.length === 0)
    return { estado: "SIN_CONFIGURAR", detalle: "sin destinatarios", messageId: null };
  const t = transporte();
  if (!t) return { estado: "SIN_CONFIGURAR", detalle: "mail sin configurar", messageId: null };
  const desde = e.GMAIL_USER ?? "no-responder@localhost";
  try {
    const info = (await t.sendMail({
      from: `${comillas(e.MAIL_FROM_NAME ?? nombreRemitente)} <${desde}>`,
      to: para,
      replyTo: m.responderA,
      subject: m.asunto,
      text: m.texto,
      html: m.html,
      attachments: m.adjuntos?.map((a) => ({
        filename: a.nombre,
        content: Buffer.from(a.contenido),
        contentType: a.tipo,
      })),
    })) as { messageId?: string; message?: unknown };
    if (!transporteFijo && e.MAIL_TRANSPORTE === "prueba") await guardarPrueba(info.message);
    return { estado: "ENVIADO", detalle: null, messageId: info.messageId ?? null };
  } catch (error) {
    logger().warn({ err: error, para }, "mail: no se pudo enviar");
    const detalle = error instanceof Error ? error.message : String(error);
    return { estado: "ERROR", detalle: detalle.slice(0, 500), messageId: null };
  }
}

/** jsonTransport → archivo `<fecha>-<aleatorio>.json` en MAIL_PRUEBA_DIR. */
async function guardarPrueba(mensaje: unknown): Promise<void> {
  const dir = path.resolve(obtenerEnv().MAIL_PRUEBA_DIR ?? ".mails-prueba");
  await mkdir(dir, { recursive: true });
  const nombre = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.json`;
  await writeFile(
    path.join(dir, nombre),
    typeof mensaje === "string" ? mensaje : JSON.stringify(mensaje),
  );
}
