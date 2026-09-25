import { EstadoCompra } from "@prisma/client";
import { z } from "zod";

import {
  enteroPositivo,
  id,
  monto,
  montoOCero,
  sinDuplicados,
  textoOpcional,
  vacioAUndefined,
} from "./common";
import { hoyAR } from "@/lib/fechas";

import { motivoAjuste } from "./movimiento";

export const compraItemSchema = z.object({
  varianteId: id,
  cantidad: enteroPositivo,
  costoUnitario: monto,
});

/**
 * Datos de una compra (crear o editar borrador). Los totales NO vienen del
 * cliente: el servidor los calcula desde los ítems.
 */
export const compraSchema = z.object({
  proveedorId: z.preprocess(vacioAUndefined, id.optional()),
  depositoId: id,
  /** "YYYY-MM-DD" (día argentino): hoy → el momento actual; otro día → 12:00 de ese día. No puede ser futura. */
  fecha: z.preprocess(
    vacioAUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
      .refine((f) => f <= hoyAR(), "La fecha no puede ser futura")
      .transform((f) => (f === hoyAR() ? new Date() : new Date(`${f}T12:00:00-03:00`)))
      .optional(),
  ),
  descuento: montoOCero,
  notas: textoOpcional(2000),
  items: z
    .array(compraItemSchema)
    .min(1, "La compra debe tener al menos un ítem")
    .max(500)
    .refine(
      (items) => sinDuplicados(items, (i) => i.varianteId),
      "Hay productos repetidos: sumá la cantidad",
    ),
});

/** Guardar (crear o actualizar borrador) y opcionalmente recibir en el mismo paso. */
export const guardarCompraSchema = z.object({
  id: z.preprocess(vacioAUndefined, id.optional()),
  datos: compraSchema,
  recibir: z.boolean().default(false),
  actualizarCostos: z.boolean().default(false),
});

export const recibirCompraSchema = z.object({ id, actualizarCostos: z.boolean().default(false) });

export const anularCompraSchema = z.object({ id, motivo: motivoAjuste });

export const listarComprasSchema = z.object({
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoCompra).optional()).catch(undefined),
  proveedorId: z.preprocess(vacioAUndefined, id.optional()).catch(undefined),
  desde: z
    .preprocess(
      vacioAUndefined,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    )
    .catch(undefined),
  hasta: z
    .preprocess(
      vacioAUndefined,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    )
    .catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(30),
});

export type CompraInput = z.input<typeof compraSchema>;
export type Compra = z.output<typeof compraSchema>;
export type FiltrosCompras = z.output<typeof listarComprasSchema>;
