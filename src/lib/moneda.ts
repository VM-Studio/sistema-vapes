/**
 * MONEDA PRINCIPAL: USDT (puro: servidor y cliente).
 *
 * Reglas del sistema (no cambiar sin hablar con los dueños):
 * - Los COSTOS son en USDT (compras en USDT, costo de la carga de stock en USDT).
 * - Los PRECIOS de venta y lo cobrado son en pesos.
 * - Cada venta congela la cotización USDT y la del dólar blue de su momento.
 *   Su total, costo y ganancia en USDT se calculan con ESA cotización y quedan
 *   fijos (la DB verifica las cuentas). Sumar montos en USDT de varias ventas
 *   es sumar lo de cada una: nunca se divide una suma en pesos por la
 *   cotización de hoy.
 * - Ganancias y totales se muestran en USDT; abajo, chiquito, lo mismo en
 *   pesos (lo real cobrado) y en dólares (cada venta a su dólar blue).
 */
import { formatearDolares, formatearPesos, formatearUsdt } from "@/lib/format";

/** Un monto en las tres monedas (strings "1234.56"). `usdt` es el principal. */
export interface Montos {
  usdt: string;
  pesos: string;
  usd: string;
}

export const MONTOS_CERO: Montos = { usdt: "0.00", pesos: "0.00", usd: "0.00" };

/** "12,50 USDT". */
export const textoPrincipal = (m: Montos | null | undefined): string =>
  m ? formatearUsdt(m.usdt) : "—";

/** "$ 21.000 · US$ 13,30" (la línea chica de abajo). */
export const textoEquivalentes = (m: Montos | null | undefined): string =>
  m ? `${formatearPesos(m.pesos)} · ${formatearDolares(m.usd)}` : "";

/** Suma de montos (centavos exactos: sin errores de coma flotante). */
export function sumarMontos(lista: readonly Montos[]): Montos {
  const s = (k: keyof Montos) =>
    (lista.reduce((a, m) => a + Math.round(Number(m[k]) * 100), 0) / 100).toFixed(2);
  return { usdt: s("usdt"), pesos: s("pesos"), usd: s("usd") };
}

/** "USDT $ 1.679 · Blue $ 1.575" (cotizaciones con las que se convirtió). */
export const textoCotizaciones = (c: { usdt: string | number; usd: string | number }): string =>
  `USDT ${formatearPesos(c.usdt)} · Blue ${formatearPesos(c.usd)}`;

/**
 * Tope de un costo por unidad en USDT. Un sabor no cuesta 500 USDT: un costo
 * así es un costo tipeado en PESOS por error (la migración a USDT usó el
 * mismo criterio). El servidor lo rechaza y la pantalla avisa.
 */
export const COSTO_USDT_MAXIMO = 500;
export const MENSAJE_COSTO_USDT =
  "El costo va en USDT (ej. 12,50), no en pesos. Usá solo números, menos de 500 USDT.";
