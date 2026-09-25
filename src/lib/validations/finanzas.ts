import { MedioPago } from "@prisma/client";
import { z } from "zod";

import { esDiaISO, ZONA_DEFAULT } from "@/lib/zona-horaria";

import { id, montoOCero, montoPositivo, texto, textoOpcional, vacioAUndefined } from "./common";

// =============================================================================
// Configuración de caja y reportes (claves sueltas de Configuracion)
// =============================================================================

const esZonaValida = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const configFinanzasSchema = z.object({
  /** Zona horaria de los límites de día de reportes y ResumenDiario. */
  timezone: z.string().trim().refine(esZonaValida, "Zona horaria inválida").default(ZONA_DEFAULT),
  /** true: no se puede cobrar en efectivo sin la caja del depósito abierta. */
  exigirCajaAbierta: z.boolean().default(false),
  /** Diferencia de arqueo (en $) a partir de la cual se exigen observaciones y revisión. */
  toleranciaArqueo: z.coerce.number().min(0).max(1_000_000).default(500),
  /** Días de cobertura para la sugerencia de reposición. */
  diasCobertura: z.coerce.number().int().min(1).max(180).default(15),
  /** Clasificación de rotación por días de stock (stock / venta diaria). */
  rotacion: z
    .object({
      /** ≤ N días de stock: RAPIDA. */
      rapidaHastaDias: z.coerce.number().int().min(1).max(365).default(15),
      /** > N días de stock: LENTA. En el medio: NORMAL. */
      lentaDesdeDias: z.coerce.number().int().min(1).max(3650).default(60),
    })
    .refine((r) => r.lentaDesdeDias > r.rapidaHastaDias, {
      message: "«Lenta desde» tiene que ser mayor que «rápida hasta»",
      path: ["lentaDesdeDias"],
    })
    .default({ rapidaHastaDias: 15, lentaDesdeDias: 60 }),
});

export type ConfigFinanzas = z.output<typeof configFinanzasSchema>;
export const CLAVES_CONFIG_FINANZAS = [
  "timezone",
  "exigirCajaAbierta",
  "toleranciaArqueo",
  "diasCobertura",
  "rotacion",
] as const;

// =============================================================================
// Gastos
// =============================================================================

const diaISO = z.string().refine(esDiaISO, "Fecha inválida");

export const MEDIOS_PAGO_GASTO = [
  MedioPago.EFECTIVO,
  MedioPago.TRANSFERENCIA,
  MedioPago.DEBITO,
  MedioPago.CREDITO,
  MedioPago.MERCADOPAGO,
  MedioPago.OTRO,
] as const;

const boolForm = z.preprocess(
  (v) => v === true || v === "true" || v === "on" || v === "1",
  z.boolean(),
);

export const gastoSchema = z.object({
  fecha: diaISO,
  categoriaGastoId: id,
  descripcion: texto(300),
  monto: montoPositivo,
  medioPago: z.enum(MEDIOS_PAGO_GASTO),
  depositoId: z.preprocess(vacioAUndefined, id.optional()),
  recurrente: boolForm.default(false),
});

export const actualizarGastoSchema = gastoSchema.extend({ id });

export type GastoInput = z.output<typeof gastoSchema>;

export const filtrosGastosSchema = z.object({
  desde: diaISO.optional().catch(undefined),
  hasta: diaISO.optional().catch(undefined),
  categoriaGastoId: z.string().min(1).optional().catch(undefined),
  depositoId: z.string().min(1).optional().catch(undefined),
  medioPago: z.enum(MedioPago).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(200).catch(50),
});

export type FiltrosGastos = z.output<typeof filtrosGastosSchema>;

// =============================================================================
// Caja
// =============================================================================

export const abrirCajaSchema = z.object({ depositoId: id, montoInicial: montoOCero });

export const movimientoManualCajaSchema = z.object({
  cajaId: id,
  monto: montoPositivo,
  descripcion: texto(200),
});

export const cerrarCajaSchema = z.object({
  cajaId: id,
  montoContado: montoOCero,
  observaciones: textoOpcional(1000),
  /** Conteo por denominación (solo informativo: queda en la auditoría). */
  conteo: z.record(z.string(), z.coerce.number().int().min(0).max(100_000)).optional(),
});

export const filtrosCajasSchema = z.object({
  depositoId: z.string().min(1).optional().catch(undefined),
  desde: diaISO.optional().catch(undefined),
  hasta: diaISO.optional().catch(undefined),
  conDiferencia: z.preprocess((v) => v === true || v === "1", z.boolean()).catch(false),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(200).catch(30),
});

export type FiltrosCajas = z.output<typeof filtrosCajasSchema>;
