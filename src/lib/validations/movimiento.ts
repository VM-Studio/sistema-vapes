import { TipoMovimiento } from "@prisma/client";
import { z } from "zod";

import {
  cantidad,
  enteroNoNegativo,
  enteroPositivo,
  id,
  montoOpcional,
  sinDuplicados,
  texto,
  textoOpcional,
  vacioAUndefined,
} from "./common";

/**
 * Tipos que se pueden cargar a mano. VENTA, INGRESO_COMPRA y TRANSFERENCIA_*
 * solo los generan sus módulos (ventas, compras, transferencias).
 */
export const TIPOS_MOVIMIENTO_MANUAL = [
  TipoMovimiento.INGRESO_MANUAL,
  TipoMovimiento.AJUSTE_POSITIVO,
  TipoMovimiento.AJUSTE_NEGATIVO,
  TipoMovimiento.DEVOLUCION_CLIENTE,
  TipoMovimiento.DEVOLUCION_PROVEEDOR,
] as const;

const TIPOS_CON_MOTIVO_OBLIGATORIO: ReadonlySet<TipoMovimiento> = new Set([
  TipoMovimiento.AJUSTE_POSITIVO,
  TipoMovimiento.AJUSTE_NEGATIVO,
  TipoMovimiento.DEVOLUCION_CLIENTE,
  TipoMovimiento.DEVOLUCION_PROVEEDOR,
]);

export const movimientoManualSchema = z
  .object({
    tipo: z.enum(TIPOS_MOVIMIENTO_MANUAL),
    varianteId: id,
    depositoId: id,
    cantidad,
    costoUnitario: montoOpcional,
    motivo: textoOpcional(500),
  })
  .refine((m) => !TIPOS_CON_MOTIVO_OBLIGATORIO.has(m.tipo) || m.motivo !== undefined, {
    message: "Indicá el motivo del ajuste o devolución",
    path: ["motivo"],
  });

/** Motivo de ajustes: obligatorio y con algo de contenido (auditoría). */
export const motivoAjuste = z
  .string()
  .trim()
  .min(5, "Contá el motivo (mínimo 5 caracteres)")
  .max(500);

const itemsSinRepetir = <T extends { varianteId: string }>(schema: z.ZodType<T>) =>
  z
    .array(schema)
    .min(1, "Agregá al menos un producto")
    .max(500)
    .refine(
      (items) => sinDuplicados(items, (i) => i.varianteId),
      "Hay productos repetidos: sumá la cantidad",
    );

/** Ingreso manual (carga inicial o entrada sin proveedor). */
export const ingresoManualSchema = z.object({
  depositoId: id,
  items: itemsSinRepetir(
    z.object({
      varianteId: id,
      cantidad: enteroPositivo,
      costoUnitario: montoOpcional,
    }),
  ),
  motivo: texto(500),
  /** Si un costo ingresado difiere del precioCosto actual, actualizarlo (con historial). */
  actualizarCosto: z.boolean().default(false),
});

/** Ajuste simple: el usuario informa el conteo real; el servicio calcula la diferencia. */
export const ajusteSchema = z.object({
  depositoId: id,
  varianteId: id,
  cantidadReal: enteroNoNegativo,
  motivo: motivoAjuste,
});

/** Recuento físico: varias variantes de un depósito. Solo se ajustan las que difieren. */
export const ajusteMasivoSchema = z.object({
  depositoId: id,
  items: itemsSinRepetir(z.object({ varianteId: id, cantidadReal: enteroNoNegativo })),
  motivo: motivoAjuste,
});

export const listarMovimientosSchema = z.object({
  varianteId: z.preprocess(vacioAUndefined, id.optional()),
  productoId: z.preprocess(vacioAUndefined, id.optional()),
  depositoId: z.preprocess(vacioAUndefined, id.optional()),
  usuarioId: z.preprocess(vacioAUndefined, id.optional()),
  tipo: z.preprocess(vacioAUndefined, z.enum(TipoMovimiento).optional()).catch(undefined),
  referenciaTipo: z
    .preprocess(
      vacioAUndefined,
      z.enum(["VENTA", "COMPRA", "TRANSFERENCIA", "AJUSTE", "DEVOLUCION"]).optional(),
    )
    .catch(undefined),
  referenciaId: z.preprocess(vacioAUndefined, z.string().max(64).optional()).catch(undefined),
  desde: z.preprocess(vacioAUndefined, z.coerce.date().optional()).catch(undefined),
  hasta: z.preprocess(vacioAUndefined, z.coerce.date().optional()).catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(200).catch(50),
});

export type MovimientoManual = z.output<typeof movimientoManualSchema>;
export type IngresoManual = z.output<typeof ingresoManualSchema>;
export type Ajuste = z.output<typeof ajusteSchema>;
export type AjusteMasivo = z.output<typeof ajusteMasivoSchema>;
export type FiltrosMovimientos = z.output<typeof listarMovimientosSchema>;
