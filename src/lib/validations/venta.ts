import { EstadoVenta, MedioPago } from "@prisma/client";
import { z } from "zod";

import {
  enteroPositivo,
  id,
  montoOpcional,
  montoPositivo,
  sinDuplicados,
  texto,
  textoOpcional,
  vacioAUndefined,
} from "./common";

/**
 * Ventas: el cliente manda ids, cantidades y el medio de pago. Precios, costos
 * y totales los calcula SIEMPRE el servidor. Precio manual y descuento global
 * solo con permiso "editar" en VENTAS (lo valida la acción, no el schema).
 */

export const REDONDEOS_VENTA = [0, 1, 10, 50, 100] as const;
export type RedondeoVenta = (typeof REDONDEOS_VENTA)[number];

export const ventaItemSchema = z.object({
  varianteId: id,
  cantidad: enteroPositivo,
  /** Precio manual (requiere permiso). Vacío/ausente → el precioVenta actual. */
  precioUnitario: montoOpcional,
});

export const descuentoGlobalSchema = z
  .discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("monto"), valor: montoPositivo }),
    z.object({
      tipo: z.literal("porcentaje"),
      valor: z.coerce.number().positive("Mayor a 0").max(100, "Máximo 100%"),
    }),
  ])
  .optional();

export const borradorVentaSchema = z.object({
  depositoId: id,
  clienteId: z.preprocess(vacioAUndefined, id.optional()),
  descuentoGlobal: descuentoGlobalSchema,
  notas: textoOpcional(2000),
  items: z
    .array(ventaItemSchema)
    .min(1, "Agregá al menos un producto")
    .max(300)
    .refine(
      (items) => sinDuplicados(items, (i) => i.varianteId),
      "Hay productos repetidos: sumá la cantidad",
    ),
});

/**
 * La venta se cobra COMPLETA en el momento con UN solo medio de pago (sin
 * pagos partidos ni cuenta corriente). El vuelto del efectivo se calcula en
 * pantalla y no se registra.
 */
export const medioPagoSchema = z.enum(MedioPago, { error: "Elegí el medio de pago" });

const redondearASchema = z.coerce
  .number()
  .refine(
    (n): n is RedondeoVenta => (REDONDEOS_VENTA as readonly number[]).includes(n),
    "Redondeo inválido",
  )
  .default(0);

export const confirmarVentaSchema = z.object({
  id,
  medioPago: medioPagoSchema,
  redondearA: redondearASchema,
});

/** Crea (o actualiza) el borrador y lo confirma: el caso normal del POS. */
export const venderSchema = z.object({
  borradorId: z.preprocess(vacioAUndefined, id.optional()),
  venta: borradorVentaSchema,
  medioPago: medioPagoSchema,
  redondearA: redondearASchema,
});

export const anularVentaSchema = z.object({ ventaId: id, motivo: texto(500) });

const fechaISO = z
  .preprocess(
    vacioAUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  )
  .catch(undefined);

export const listarVentasSchema = z.object({
  desde: fechaISO,
  hasta: fechaISO,
  depositoId: z.preprocess(vacioAUndefined, id.optional()).catch(undefined),
  clienteId: z.preprocess(vacioAUndefined, id.optional()).catch(undefined),
  usuarioId: z.preprocess(vacioAUndefined, id.optional()).catch(undefined),
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoVenta).optional()).catch(undefined),
  medioPago: z.preprocess(vacioAUndefined, z.enum(MedioPago).optional()).catch(undefined),
  q: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()).catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(30),
});

// --- Configuración de ventas del panel (clave "ventas") ---------------------------

export const configVentasSchema = z.object({
  redondeoVentas: z.coerce
    .number()
    .refine((n) => [0, 10, 50, 100].includes(n), "Elegí 0, 10, 50 o 100")
    .default(0),
});

export type ConfigVentas = z.output<typeof configVentasSchema>;
export type BorradorVenta = z.output<typeof borradorVentaSchema>;
export type BorradorVentaInput = z.input<typeof borradorVentaSchema>;
export type Vender = z.output<typeof venderSchema>;
export type FiltrosVentas = z.output<typeof listarVentasSchema>;
