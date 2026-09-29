import { EstadoVenta, MedioPago, TipoMovimiento, TipoVenta } from "@prisma/client";
import { z } from "zod";

import {
  diaEn,
  esDiaISO,
  limitesRango,
  PERIODO_LABEL,
  PERIODOS,
  rangoDePeriodo,
  ZONA_DEFAULT,
  type DiaISO,
  type Periodo,
} from "@/lib/zona-horaria";

/**
 * Filtros de los reportes (vienen de la URL: la página y la exportación leen
 * los MISMOS parámetros, así el PDF/Excel es lo que se está viendo).
 * Período: `periodo` (preset) o `desde`/`hasta` (días en hora argentina).
 */

export interface RangoReporte {
  periodo: Periodo;
  desde: DiaISO;
  hasta: DiaISO;
  /** Límites UTC: [inicio, fin). */
  inicio: Date;
  fin: Date;
  etiqueta: string;
}

const fmt = (d: DiaISO) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function rangoReporte(
  params: Record<string, string | undefined>,
  ahora: Date = new Date(),
  porDefecto: Periodo = "30d",
): RangoReporte {
  const periodo = (PERIODOS as readonly string[]).includes(params.periodo ?? "")
    ? (params.periodo as Periodo)
    : esDiaISO(params.desde) || esDiaISO(params.hasta)
      ? "personalizado"
      : porDefecto;
  const { desde, hasta } = rangoDePeriodo(periodo, diaEn(ahora, ZONA_DEFAULT), {
    desde: params.desde,
    hasta: params.hasta,
  });
  const { inicio, fin } = limitesRango(desde, hasta, ZONA_DEFAULT);
  const etiqueta = desde === hasta ? fmt(desde) : `${fmt(desde)} al ${fmt(hasta)}`;
  return {
    periodo,
    desde,
    hasta,
    inicio,
    fin,
    etiqueta: periodo === "personalizado" ? etiqueta : `${PERIODO_LABEL[periodo]} (${etiqueta})`,
  };
}

const opcional = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), s.optional());
const idOpc = opcional(z.string().min(1).max(64));

export const filtrosVentasSchema = z.object({
  vendedorId: idOpc,
  depositoId: idOpc,
  medioPago: opcional(z.enum(MedioPago)),
  tipo: opcional(z.enum(TipoVenta)),
  /** Default: solo confirmadas. "TODAS" incluye anuladas. */
  estado: opcional(z.enum([EstadoVenta.CONFIRMADA, EstadoVenta.ANULADA, "TODAS"])),
  page: opcional(z.coerce.number().int().min(1).max(10_000)).transform((p) => p ?? 1),
});
export type FiltrosVentasReporte = z.infer<typeof filtrosVentasSchema>;

export const filtrosStockSchema = z.object({
  depositoId: idOpc,
  q: opcional(z.string().trim().max(80)),
  estado: opcional(z.enum(["OK", "BAJO", "SIN_STOCK"])),
});
export type FiltrosStockReporte = z.infer<typeof filtrosStockSchema>;

export const filtrosMovimientosSchema = z.object({
  tipo: opcional(z.enum(TipoMovimiento)),
  depositoId: idOpc,
  usuarioId: idOpc,
});
export type FiltrosMovimientosReporte = z.infer<typeof filtrosMovimientosSchema>;

export const filtrosComprasSchema = z.object({
  proveedorId: idOpc,
  productoId: idOpc,
});
export type FiltrosComprasReporte = z.infer<typeof filtrosComprasSchema>;

export const filtrosDevolucionesSchema = z.object({ depositoId: idOpc });
export type FiltrosDevolucionesReporte = z.infer<typeof filtrosDevolucionesSchema>;

/** "2026-09" (mes del resumen mensual); default: el mes anterior al actual. */
export function mesResumen(param: string | undefined, ahora: Date = new Date()): string {
  if (param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param)) return param;
  const hoy = diaEn(ahora, ZONA_DEFAULT);
  const [a, m] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

/** Primer y último día de un mes "YYYY-MM". */
export function diasDelMes(mes: string): { desde: DiaISO; hasta: DiaISO } {
  const [a, m] = [Number(mes.slice(0, 4)), Number(mes.slice(5, 7))];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function nombreMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
}
