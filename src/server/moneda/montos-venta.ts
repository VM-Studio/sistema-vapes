import { Prisma } from "@prisma/client";

import type { Montos } from "@/lib/moneda";

/**
 * Montos de una venta en las tres monedas (ver src/lib/moneda.ts). USDT y
 * pesos salen guardados de la venta; dólares = pesos ÷ dólar blue DE LA VENTA,
 * a centavos (mitad lejos del cero, igual que ROUND de Postgres: las sumas
 * por SQL con `SQL_USD_*` dan lo mismo que sumar esto venta por venta).
 */
type Dec = Prisma.Decimal;
const r2 = (d: Dec) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export function enDolares(pesos: Dec, tipoCambioUsd: Dec): Dec {
  return r2(pesos.div(tipoCambioUsd));
}

export function totalDeVenta(v: { totalUsdt: Dec; total: Dec; tipoCambioUsd: Dec }): Montos {
  return {
    usdt: v.totalUsdt.toFixed(2),
    pesos: v.total.toFixed(2),
    usd: enDolares(v.total, v.tipoCambioUsd).toFixed(2),
  };
}

export function gananciaDeVenta(v: {
  gananciaUsdt: Dec;
  gananciaBruta: Dec;
  tipoCambioUsd: Dec;
}): Montos {
  return {
    usdt: v.gananciaUsdt.toFixed(2),
    pesos: v.gananciaBruta.toFixed(2),
    usd: enDolares(v.gananciaBruta, v.tipoCambioUsd).toFixed(2),
  };
}

export function costoDeVenta(v: {
  costoTotalUsdt: Dec;
  costoTotal: Dec;
  tipoCambioUsd: Dec;
}): Montos {
  return {
    usdt: v.costoTotalUsdt.toFixed(2),
    pesos: v.costoTotal.toFixed(2),
    usd: enDolares(v.costoTotal, v.tipoCambioUsd).toFixed(2),
  };
}

/** Suma exacta (Decimal) de montos de varias ventas. */
export function sumar(lista: Iterable<Montos>): Montos {
  let u = new Prisma.Decimal(0);
  let p = new Prisma.Decimal(0);
  let d = new Prisma.Decimal(0);
  for (const m of lista) {
    u = u.plus(m.usdt);
    p = p.plus(m.pesos);
    d = d.plus(m.usd);
  }
  return { usdt: u.toFixed(2), pesos: p.toFixed(2), usd: d.toFixed(2) };
}

/**
 * Fragmentos SQL (alias de la venta `v`) para sumar en la base las mismas
 * cuentas: SUM(SQL_USD_TOTAL) = Σ totalDeVenta().usd.
 */
export const SQL_USD_TOTAL = Prisma.sql`ROUND(v."total" / v."tipoCambioUsd", 2)`;
export const SQL_USD_GANANCIA = Prisma.sql`ROUND(v."gananciaBruta" / v."tipoCambioUsd", 2)`;
export const SQL_USD_COSTO = Prisma.sql`ROUND(v."costoTotal" / v."tipoCambioUsd", 2)`;
