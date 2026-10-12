import type { MedioPago } from "@prisma/client";

/**
 * Medios de pago (puro: servidor y cliente).
 *
 * Cada panel elige qué medios ofrece y en qué orden (configuración de ventas,
 * clave "ventas".mediosPago); de ahí leen el paso «¿Cómo paga?», «Dividir
 * pago», los cobros de fiados, la diferencia de las devoluciones y los filtros.
 * Los reportes muestran además cualquier medio que tenga ventas aunque ya no
 * esté habilitado (ventas viejas).
 */

/** Todos los medios que existen, en el orden en que se ofrecen por defecto. */
export const TODOS_LOS_MEDIOS: readonly MedioPago[] = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "BINANCE",
  "MERCADO_LIBRE",
];

/** Lo que ofrece un panel que todavía no eligió sus medios. */
export const MEDIOS_PAGO_DEFAULT: readonly MedioPago[] = ["EFECTIVO", "TRANSFERENCIA", "BINANCE"];

/** "Efectivo, Transferencia o Binance". */
export function listaDeMedios(medios: readonly MedioPago[], etiquetas: Record<MedioPago, string>) {
  const nombres = medios.map((m) => etiquetas[m]);
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} o ${nombres.at(-1)}`;
}

/**
 * Medio principal de un conjunto de pagos: el de mayor monto (a igualdad, el
 * primero que se cargó). null si no hay pagos con monto.
 */
export function medioPrincipal(
  pagos: readonly { medioPago: MedioPago; monto: string | number }[],
): MedioPago | null {
  let mejor: { medioPago: MedioPago; monto: number } | null = null;
  for (const p of pagos) {
    const monto = Number(p.monto);
    if (!(monto > 0)) continue;
    if (mejor === null || monto > mejor.monto) mejor = { medioPago: p.medioPago, monto };
  }
  return mejor?.medioPago ?? null;
}

/**
 * ¿La venta se cobra por Mercado Libre? Sí si el pago único o el de mayor
 * monto es MERCADO_LIBRE (entonces cada ítem va a su precio Mercado Libre).
 */
export const esCobroMercadoLibre = (
  pagos: readonly { medioPago: MedioPago; monto: string | number }[],
) => medioPrincipal(pagos) === "MERCADO_LIBRE";

/** ¿El panel cobra por Mercado Libre? (habilita el precio ML en productos y ventas). */
export const tieneMercadoLibre = (cfg: { mediosPago: readonly MedioPago[] }) =>
  cfg.mediosPago.includes("MERCADO_LIBRE");
