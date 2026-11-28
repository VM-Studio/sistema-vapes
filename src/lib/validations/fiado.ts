import { z } from "zod";

import { id, montoPositivo, sinDuplicados, texto, textoOpcional, vacioAUndefined } from "./common";
import { clienteVentaSchema, medioPagoSchema } from "./venta";

/**
 * Fiados (cuenta corriente): el cliente manda cuánto cobró, con qué medio y,
 * opcionalmente, a qué ventas imputarlo. Saldos e imputación los calcula
 * SIEMPRE el servidor (de la venta más vieja a la más nueva por defecto).
 */

const fechaISO = z.preprocess(
  vacioAUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
    .optional(),
);

export const registrarCobroSchema = z.object({
  clienteId: id,
  monto: montoPositivo,
  medioPago: medioPagoSchema,
  referencia: textoOpcional(100),
  /** Día del cobro (YYYY-MM-DD, hora argentina); vacío = ahora. No puede ser futuro. */
  fecha: fechaISO,
  /** Solo estas ventas (en su orden de antigüedad); vacío = todas las pendientes. */
  ventaIds: z
    .array(id)
    .max(200)
    .refine((v) => sinDuplicados(v, (x) => x), "Hay ventas repetidas")
    .optional(),
});

export const anularCobroSchema = z.object({
  pagoId: id,
  motivo: texto(500).refine((m) => m.length >= 3, "Contá brevemente por qué se anula"),
});

/**
 * «Cargar fiado anterior»: lo que un cliente ya debía antes del sistema.
 * Cliente existente o nuevo (como en una venta), monto en pesos, desde cuándo
 * debe (vacío = hoy; no futuro) y qué debe (opcional).
 */
export const cargarFiadoAnteriorSchema = z.object({
  cliente: clienteVentaSchema,
  monto: montoPositivo,
  fecha: fechaISO,
  concepto: textoOpcional(200),
});

export const anularFiadoAnteriorSchema = z.object({
  fiadoId: id,
  motivo: texto(500).refine((m) => m.length >= 3, "Contá brevemente por qué se anula"),
});

export const listarDeudoresSchema = z.object({
  q: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()).catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});

export type RegistrarCobro = z.output<typeof registrarCobroSchema>;
export type CargarFiadoAnterior = z.output<typeof cargarFiadoAnteriorSchema>;
export type FiltrosDeudores = z.output<typeof listarDeudoresSchema>;
