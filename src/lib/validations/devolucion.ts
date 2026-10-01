import { z } from "zod";

import { prefijoPanel } from "@/lib/paneles";

import { MedioPago } from "@prisma/client";

import { id, montoOpcional, texto } from "./common";

/** ID visible de una devolución: VAP-D-000001. */
export function formatearIdDevolucion(slug: string, numero: number): string {
  return `${prefijoPanel(slug)}-D-${String(numero).padStart(6, "0")}`;
}

/** Mismo mínimo que el CHECK de la DB (Devolucion_observacion_chk). */
export const OBSERVACION_MINIMA = 10;

export const observacionDevolucion = z
  .string({ error: "Contá qué le pasó al producto" })
  .trim()
  .min(
    OBSERVACION_MINIMA,
    `Contá qué le pasó al producto (mínimo ${OBSERVACION_MINIMA} caracteres)`,
  )
  .max(1000, "Máximo 1000 caracteres");

export const itemDevolucionSchema = z.object({
  /** El sabor fallado que trae el cliente. */
  varianteId: id,
  cantidad: z
    .number({ error: "Cantidad inválida" })
    .int("Tiene que ser un número entero")
    .positive("Tiene que ser mayor a 0")
    .max(10_000, "Cantidad demasiado grande"),
  /** Lo que se le entrega (otro sabor u otro modelo). Ausente = el mismo sabor. */
  varianteEntregadaId: id.optional().nullable(),
});

export const registrarDevolucionSchema = z.object({
  clienteId: id,
  ventaId: id.optional().nullable(),
  depositoId: id,
  items: z.array(itemDevolucionSchema).min(1, "Agregá al menos un producto").max(100),
  observacion: observacionDevolucion,
  /**
   * Diferencia de precio que vio la pantalla (con signo: > 0 cobrar, < 0
   * devolver). Si el servidor calcula otra (cambió un precio), no se registra.
   */
  diferenciaVista: z.number().finite().optional(),
  /**
   * Cuánto se cobra o se devuelve efectivamente (valor absoluto): la
   * diferencia entera si no viene, o menos para bonificar.
   */
  montoDiferencia: montoOpcional,
  medioPagoDiferencia: z.enum(MedioPago, { error: "Elegí el medio de pago" }).optional().nullable(),
});

export const anularDevolucionSchema = z.object({
  id,
  motivo: texto(500).refine((m) => m.length >= 5, "Contá por qué se anula (mínimo 5 caracteres)"),
});

export type RegistrarDevolucion = z.output<typeof registrarDevolucionSchema>;
export type ItemDevolucion = z.output<typeof itemDevolucionSchema>;
