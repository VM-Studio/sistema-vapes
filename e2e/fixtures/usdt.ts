import { Prisma } from "@prisma/client";

/**
 * Columnas USDT de una venta armada a mano en un test (ver src/lib/moneda.ts):
 * cotización fija, total en USDT y costos en USDT → pesos a esa cotización.
 * Las mismas cuentas que verifica la DB (CHECK + trigger diferido).
 */
export const COTIZACION_TEST = { usdt: 1350, usd: 1300 };

const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Costo en pesos de un costo en USDT, a la cotización del test. */
export function costoEnPesos(costoUsdt: number | string): number {
  return r2(new Prisma.Decimal(costoUsdt).mul(COTIZACION_TEST.usdt)).toNumber();
}

/** Campos de la venta: total en pesos y Σ cantidad × costo USDT de sus ítems. */
export function columnasUsdt(
  total: number | string | Prisma.Decimal,
  costoTotalUsdt: number | string,
) {
  const totalUsdt = r2(new Prisma.Decimal(total).div(COTIZACION_TEST.usdt));
  const costo = new Prisma.Decimal(costoTotalUsdt);
  return {
    tipoCambioUsdt: COTIZACION_TEST.usdt,
    tipoCambioUsd: COTIZACION_TEST.usd,
    totalUsdt: totalUsdt.toNumber(),
    costoTotalUsdt: costo.toNumber(),
    gananciaUsdt: totalUsdt.minus(costo).toNumber(),
  };
}
