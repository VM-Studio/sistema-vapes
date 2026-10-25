import { MedioPago } from "@prisma/client";
import { z } from "zod";

import { hoyAR } from "@/lib/fechas";

import { id, monto } from "./common";

export const mesSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido");

/** $ por vape de cada categoría (0 = no gana nada en esa categoría). */
export const guardarTarifasSchema = z.object({
  usuarioId: id,
  minorista: monto,
  mayorista: monto,
  minoristaNuevo: monto,
  mayoristaNuevo: monto,
});

export const generarLiquidacionSchema = z.object({ usuarioId: id, mes: mesSchema });

/** Pago de una liquidación: monto (precargado con el total), medio, fecha (no futura) y referencia. */
export const pagoLiquidacionSchema = z.object({
  id,
  monto: monto.refine((v) => v > 0, "El monto tiene que ser mayor a cero"),
  medioPago: z.enum(MedioPago, { error: "Elegí cómo se le pagó" }),
  referencia: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** "YYYY-MM-DD" (día argentino): hoy → ahora; otro día → 12:00 de ese día. */
  fecha: z
    .string({ error: "Elegí la fecha del pago" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
    .refine((f) => f <= hoyAR(), "La fecha no puede ser futura")
    .transform((f) => (f === hoyAR() ? new Date() : new Date(`${f}T12:00:00-03:00`))),
});

/** PNG del canvas de firma ("data:image/png;base64,…"); el servidor lo re-codifica y valida. */
export const firmaSchema = z
  .string({ error: "Firmá en el recuadro" })
  .max(2_000_000, "La firma es demasiado grande")
  .regex(/^data:image\/png;base64,/, "Firmá en el recuadro");

/** Registrar pago (dueño): el pago + su firma. */
export const pagoConFirmaSchema = pagoLiquidacionSchema.extend({ firma: firmaSchema });

export const firmarRemitoSchema = z.object({ id, firma: firmaSchema });

export const firmarConTokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Link inválido"),
  firma: firmaSchema,
});
