/**
 * COSTO FINAL DE UNA COMPRA (función pura: la usan el servidor, que es el
 * que guarda, y los formularios para mostrar el resumen en vivo).
 *
 *   base       = subtotal − descuento
 *   comisión   = base × % del pasista            (redondeada a centavos)
 *   costoFinal = base + comisión + gastos extras
 *   recargo    = (comisión + gastos) ÷ unidades  ← POR UNIDAD
 *   costoUnitarioFinal (de cada ítem) = costoUnitario + recargo
 *
 * ¿Por qué se prorratea por UNIDAD y no por valor? El pasista y el envío
 * cobran por bulto, no por precio: traer un vape de $5.000 o uno de $15.000
 * ocupa el mismo lugar en la valija y le lleva el mismo trabajo al pasista.
 * Prorratear por valor cargaría más recargo a los productos caros y
 * subestimaría el costo real de los baratos.
 *
 * Cuentas en centavos enteros (sin errores de coma flotante). Redondeo:
 * mitad hacia arriba, igual que ROUND() de Postgres para montos positivos
 * (la DB verifica comisión y promedio con ROUND(…, 2)).
 */

export interface ItemCostoCompra {
  cantidad: number;
  /** En pesos. */
  costoUnitario: string | number;
}

export interface EntradaCostosCompra {
  items: ItemCostoCompra[];
  descuento?: string | number;
  /** null = sin comisión del pasista. */
  comisionPorcentaje: string | number | null;
  /** Montos de los gastos extras vigentes (no anulados). */
  gastos: (string | number)[];
}

export interface CostosFinales {
  subtotal: number;
  descuento: number;
  /** subtotal − descuento (= Compra.total). */
  total: number;
  comisionPorcentaje: number | null;
  comision: number;
  gastos: number;
  /** total + comisión + gastos. */
  costoFinalTotal: number;
  unidades: number;
  /** (comisión + gastos) ÷ unidades, sin redondear. */
  recargoPorUnidad: number;
  /** costoFinalTotal ÷ unidades, a centavos (0 sin unidades). */
  costoUnitarioFinalPromedio: number;
  /** Mismo orden que `items`: costo unitario + recargo, a centavos. */
  items: { costoUnitarioFinal: number }[];
}

/** "1.234,5" / "1234.5" / 1234.5 → 123450 centavos. */
function aCentavos(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const aPesos = (centavos: number) => centavos / 100;

export function calcularCostosFinales(c: EntradaCostosCompra): CostosFinales {
  const items = c.items.map((i) => ({
    cantidad: Number.isInteger(i.cantidad) && i.cantidad > 0 ? i.cantidad : 0,
    costo: aCentavos(i.costoUnitario),
  }));
  const subtotal = items.reduce((a, i) => a + i.cantidad * i.costo, 0);
  const descuento = Math.min(aCentavos(c.descuento), subtotal);
  const total = subtotal - descuento;
  // % con 2 decimales en centésimos enteros: total × pct ÷ 10.000 es exacto hasta el redondeo.
  const pct =
    c.comisionPorcentaje === null || c.comisionPorcentaje === ""
      ? null
      : Math.round(Number(String(c.comisionPorcentaje).replace(",", ".")) * 100);
  const comisionPorcentaje = pct !== null && Number.isFinite(pct) && pct > 0 ? pct : null;
  const comision =
    comisionPorcentaje === null ? 0 : Math.round((total * comisionPorcentaje) / 10_000);
  const gastos = c.gastos.reduce<number>((a, g) => a + aCentavos(g), 0);
  const costoFinalTotal = total + comision + gastos;
  const unidades = items.reduce((a, i) => a + i.cantidad, 0);
  const recargo = unidades > 0 ? (comision + gastos) / unidades : 0;
  return {
    subtotal: aPesos(subtotal),
    descuento: aPesos(descuento),
    total: aPesos(total),
    comisionPorcentaje: comisionPorcentaje === null ? null : comisionPorcentaje / 100,
    comision: aPesos(comision),
    gastos: aPesos(gastos),
    costoFinalTotal: aPesos(costoFinalTotal),
    unidades,
    recargoPorUnidad: recargo / 100,
    costoUnitarioFinalPromedio: unidades > 0 ? aPesos(Math.round(costoFinalTotal / unidades)) : 0,
    items: items.map((i) => ({ costoUnitarioFinal: aPesos(Math.round(i.costo + recargo)) })),
  };
}

/** Comisión del pasista por defecto (Configuracion "compras"), en %. */
export const COMISION_PASISTA_DEFAULT = 10;
