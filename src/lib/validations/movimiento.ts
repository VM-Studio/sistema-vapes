import { TipoMovimiento } from "@prisma/client";
import { z } from "zod";

import { cantidad, id, montoOpcional, textoOpcional } from "./common";

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

export type MovimientoManual = z.output<typeof movimientoManualSchema>;
