import { EstadoCompra } from "@prisma/client";
import { z } from "zod";

import { enteroPositivo, id, monto, sinDuplicados, textoOpcional, vacioAUndefined } from "./common";
import { hoyAR } from "@/lib/fechas";

import { motivoAjuste } from "./movimiento";

export const compraItemSchema = z.object({
  varianteId: id,
  cantidad: enteroPositivo,
  costoUnitario: monto,
});

/** Id obligatorio con mensaje propio ("" → falta). */
const obligatorio = (mensaje: string) =>
  z.preprocess(vacioAUndefined, z.string({ error: mensaje }).trim().min(1, mensaje));

/**
 * Datos de una compra (crear o editar borrador). Los totales NO vienen del
 * cliente: el servidor los calcula desde los ítems. Proveedor y galpón
 * destino son obligatorios.
 */
export const compraSchema = z.object({
  proveedorId: obligatorio("Elegí el proveedor"),
  depositoId: obligatorio("Elegí el galpón donde entra la mercadería"),
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
  notas: textoOpcional(2000),
  items: z
    .array(compraItemSchema)
    .min(1, "La compra tiene que tener al menos un producto")
    .max(500)
    .refine(
      (items) => sinDuplicados(items, (i) => i.varianteId),
      "Hay sabores repetidos: sumá la cantidad",
    ),
});

/** Guardar el borrador (crear si no tiene id, si no actualizar). */
export const guardarCompraSchema = z.object({
  id: z.preprocess(vacioAUndefined, id.optional()),
  datos: compraSchema,
});

export const recibirCompraSchema = z.object({
  id,
  actualizarPrecioProveedor: z.boolean().default(false),
});

export const anularCompraSchema = z.object({ id, motivo: motivoAjuste });

export const costoSugeridoSchema = z.object({
  proveedorId: id,
  varianteIds: z.array(id).min(1).max(500),
});

const fechaFiltro = z
  .preprocess(
    vacioAUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  )
  .catch(undefined);

export const listarComprasSchema = z.object({
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoCompra).optional()).catch(undefined),
  proveedorId: z.preprocess(vacioAUndefined, id.optional()).catch(undefined),
  desde: fechaFiltro,
  hasta: fechaFiltro,
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(30),
});

export type CompraInput = z.input<typeof compraSchema>;
export type Compra = z.output<typeof compraSchema>;
export type FiltrosCompras = z.output<typeof listarComprasSchema>;
