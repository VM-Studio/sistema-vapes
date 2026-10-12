/**
 * Cotizaciones de moneda (USDT y dólar blue): tipos y cálculos PUROS, usables
 * desde el cliente. Las cotizaciones se obtienen siempre en el servidor
 * (src/server/services/cambio.service.ts); acá solo se convierte y se formatea
 * con el valor que el servidor ya mandó.
 */
import { formatearNumero, formatearPesos } from "@/lib/format";

export const MONEDAS_CAMBIO = ["USD_BLUE", "USDT"] as const;
export type MonedaCambioClave = (typeof MONEDAS_CAMBIO)[number];
export type TipoCotizacionCambioClave = "COMPRA" | "VENTA";

/** Sin actualizar por más de esto, la cotización se marca como desactualizada. */
export const HORAS_DESACTUALIZADA = 2;
export const FRECUENCIA_MINUTOS_DEFAULT = 15;
export const FRECUENCIA_MINUTOS_MIN = 5;
export const FRECUENCIA_MINUTOS_MAX = 24 * 60;

export const MONEDA_CAMBIO_LABEL: Record<MonedaCambioClave, string> = {
  USD_BLUE: "Dólar blue",
  USDT: "USDT",
};

/** Etiqueta corta (widget de la barra). */
export const MONEDA_CAMBIO_CORTA: Record<MonedaCambioClave, string> = {
  USD_BLUE: "Blue",
  USDT: "USDT",
};

/** Cotización vigente tal como la manda el servidor (fechas en ISO). */
export interface CotizacionVigente {
  moneda: MonedaCambioClave;
  tipo: TipoCotizacionCambioClave;
  /** Pesos por unidad. */
  valor: number;
  /** Cuándo la obtuvo el sistema (o cuándo se cargó el override). */
  obtenidoAt: string;
  fuente: string;
  esManual: boolean;
  desactualizada: boolean;
  /** Solo si es manual: quién la cargó. */
  cargadaPor?: string | null;
}

export function estaDesactualizada(
  obtenidoAt: Date,
  ahora: Date,
  horas: number = HORAS_DESACTUALIZADA,
): boolean {
  return ahora.getTime() - obtenidoAt.getTime() > horas * 3_600_000;
}

/** Monto en la moneda → pesos enteros con la cotización dada. */
export function convertirConCotizacion(monto: number, valorCambio: number): number {
  return Math.round(monto * valorCambio);
}

function numeroMoneda(n: number): string {
  return Number.isInteger(n)
    ? formatearNumero(n)
    : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "U$D 1.200" / "150 USDT". */
export function formatearMonedaCambio(monto: number, moneda: MonedaCambioClave): string {
  return moneda === "USDT" ? `${numeroMoneda(monto)} USDT` : `U$D ${numeroMoneda(monto)}`;
}

/**
 * "U$D 1.200 · $ 1.560.000" / "150 USDT · $ 195.000". Sin cotización
 * (nunca se pudo obtener ni hay override) muestra solo la moneda.
 */
export function formatearDual(
  monto: number,
  moneda: MonedaCambioClave,
  valorCambio: number | null | undefined,
): string {
  const original = formatearMonedaCambio(monto, moneda);
  if (!valorCambio) return original;
  return `${original} · ${formatearPesos(convertirConCotizacion(monto, valorCambio))}`;
}

/** "≈ $ 195.000" (equivalente en gris al lado de un precio en moneda). */
export function formatearEquivalente(
  monto: number,
  valorCambio: number | null | undefined,
): string | null {
  if (!valorCambio) return null;
  return `≈ ${formatearPesos(convertirConCotizacion(monto, valorCambio))}`;
}

const hora = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});
const fechaHora = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** "15:30" (hora de Argentina). */
export function horaCotizacion(iso: string | Date): string {
  return hora.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "11/10 15:30" (hora de Argentina). */
export function fechaHoraCotizacion(iso: string | Date): string {
  return fechaHora.format(typeof iso === "string" ? new Date(iso) : iso).replace(",", "");
}
