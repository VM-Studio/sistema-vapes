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

/** % del pasista: vacío/null = sin comisión; si no, (0, 100] con 2 decimales. */
export const porcentajePasista = z.preprocess(
  (v) =>
    v === null ? undefined : vacioAUndefined(typeof v === "string" ? v.replace(",", ".") : v),
  z.coerce
    .number({ error: "Porcentaje inválido" })
    .gt(0, "El porcentaje tiene que ser mayor a 0")
    .max(100, "Como máximo 100%")
    .multipleOf(0.01, "Hasta 2 decimales")
    .optional()
    .transform((v) => v ?? null),
);

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
  /** % de comisión del pasista sobre el total (null/vacío = sin comisión). */
  comisionPasistaPorcentaje: porcentajePasista,
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

/** Cambiar (o quitar) la comisión del pasista de una compra ya guardada. */
export const comisionPasistaSchema = z.object({
  id,
  comisionPasistaPorcentaje: porcentajePasista,
});

const montoGasto = z.preprocess(
  (v) => vacioAUndefined(typeof v === "string" ? v.replace(",", ".") : v),
  z.coerce
    .number({ error: (iss) => (iss.input === undefined ? "Ingresá el monto" : "Monto inválido") })
    .finite("Monto inválido")
    .gt(0, "El monto tiene que ser mayor a 0")
    .max(9_999_999_999.99, "Monto demasiado grande")
    .multipleOf(0.01, "Hasta 2 decimales"),
);

export const gastoCompraSchema = z.object({
  motivo: z.string().trim().min(2, "Contá de qué es el gasto (ej. Valija, Envío)").max(120),
  monto: montoGasto,
});

/** Agregar uno o más gastos extras a una compra. */
export const agregarGastosCompraSchema = z.object({
  compraId: id,
  gastos: z.array(gastoCompraSchema).min(1, "Cargá al menos un gasto").max(50),
});

export const anularGastoCompraSchema = z.object({ id, motivo: motivoAjuste });

export const costoSugeridoSchema = z.object({
  proveedorId: id,
  /** Borrador en edición: usa su cotización USDT (snapshot) en vez de la vigente. */
  compraId: z.preprocess(vacioAUndefined, id.optional()),
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
