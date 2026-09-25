import "server-only";

import { Prisma, type TipoNotificacion } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ahora } from "@/lib/reloj";

/**
 * Canales de notificación. Hoy solo existe el aviso dentro de la app
 * (campana + /notificaciones). WhatsApp y email quedan como stubs con la
 * interfaz lista: implementarlos no toca a quien notifica.
 */

export interface NotificacionNueva {
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  /** Deduplica: no se repite mientras el destinatario tenga una sin leer con la misma clave. */
  clave: string;
  href?: string;
  datos?: Record<string, unknown>;
}

export interface Destinatario {
  id: string;
  nombre: string;
  email: string;
}

export interface NotificacionChannel {
  readonly nombre: string;
  /** false: el canal existe pero no está configurado (se saltea). */
  readonly habilitado: boolean;
  /** Devuelve cuántas notificaciones efectivamente envió (0 si eran repetidas). */
  enviar(n: NotificacionNueva, destinatarios: Destinatario[]): Promise<number>;
}

/** Fila en Notificacion por destinatario (con deduplicación por clave). */
export class InAppChannel implements NotificacionChannel {
  readonly nombre = "in-app";
  readonly habilitado = true;

  async enviar(n: NotificacionNueva, destinatarios: Destinatario[]): Promise<number> {
    if (destinatarios.length === 0) return 0;
    const yaAvisados = await prisma.notificacion.findMany({
      where: {
        usuarioId: { in: destinatarios.map((d) => d.id) },
        leida: false,
        datos: { path: ["clave"], equals: n.clave },
      },
      select: { usuarioId: true },
    });
    const avisados = new Set(yaAvisados.map((a) => a.usuarioId));
    const nuevos = destinatarios.filter((d) => !avisados.has(d.id));
    if (nuevos.length === 0) return 0;
    const datos = {
      ...(n.datos ?? {}),
      clave: n.clave,
      href: n.href ?? null,
    } as Prisma.InputJsonValue;
    const r = await prisma.notificacion.createMany({
      data: nuevos.map((d) => ({
        tipo: n.tipo,
        titulo: n.titulo,
        mensaje: n.mensaje,
        datos,
        usuarioId: d.id,
        createdAt: ahora(),
      })),
    });
    return r.count;
  }
}

/**
 * STUB — WhatsApp (no implementado a propósito).
 * Para implementarlo:
 *  1. Elegir proveedor: WhatsApp Cloud API (Meta) o un BSP (Twilio, 360dialog).
 *  2. Guardar en Configuracion el token y el phone_number_id (nunca en el código)
 *     y el teléfono de cada destinatario en Usuario.
 *  3. Los mensajes proactivos exigen PLANTILLAS aprobadas por Meta: crear una
 *     por tipo (stock bajo, caja con diferencia, …) y mandar `titulo`/`mensaje`
 *     como parámetros.
 *  4. Poner `habilitado` en true cuando haya credenciales y sumarlo a CANALES.
 */
export class WhatsAppChannel implements NotificacionChannel {
  readonly nombre = "whatsapp";
  readonly habilitado = false;
  async enviar(): Promise<number> {
    return 0;
  }
}

/**
 * STUB — Email (no implementado a propósito).
 * Para implementarlo: un proveedor transaccional (Resend, SES, Postmark) con
 * API key en variables de entorno, remitente verificado del dominio del
 * negocio y una plantilla simple (título + mensaje + botón a `href`).
 * Poner `habilitado` en true y sumarlo a CANALES.
 */
export class EmailChannel implements NotificacionChannel {
  readonly nombre = "email";
  readonly habilitado = false;
  async enviar(): Promise<number> {
    return 0;
  }
}

export const CANALES: readonly NotificacionChannel[] = [
  new InAppChannel(),
  new WhatsAppChannel(),
  new EmailChannel(),
];
