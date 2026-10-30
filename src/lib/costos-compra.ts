/**
 * COSTO FINAL DE UNA COMPRA (función pura: la usan el servidor, que es el
 * que guarda, y los formularios para mostrar el resumen en vivo).
 *
 *   base             = subtotal − descuento                 (= Compra.total)
 *   comisión         = ROUND(base × % / 100, 2)             (= Compra.comisionPasistaMonto, CHECK)
 *   costoFinal       = base + comisión + gastos extras
 *
 * POR UNIDAD, cada ítem (sabor) tiene su propio costo final:
 *
 *   factorDescuento  = base ÷ subtotal                       (1 si subtotal = 0)
 *   pasista / u      = costoUnitario × factorDescuento × % / 100   ← PROPORCIONAL AL PRECIO
 *   gastos / u       = gastos extras ÷ unidades totales            ← IGUAL PARA TODAS
 *   costoUnitarioFinal = costoUnitario + pasista/u + gastos/u      (a centavos)
 *
 * ¿Por qué así? El pasista cobra un % de lo que vale la mercadería: un vape
 * de $20.000 le deja el doble de comisión que uno de $10.000, así que a cada
 * modelo se le suma su parte proporcional. Los gastos extras (valija, envío)
 * son por bulto: se dividen parejo por la cantidad de unidades.
 *
 * Redondeo: todo en centavos enteros (sin errores de coma flotante), mitad
 * hacia arriba (igual que ROUND() de Postgres para montos positivos). Al
 * redondear cada ítem a centavos, Σ cantidad × costo final puede no cuadrar
 * por unos centavos con subtotal + comisión + gastos. Ese residuo se reparte
 * de forma determinística: primero en UN ítem cuya cantidad lo divida exacto
 * (del de mayor subtotal al de menor; empate, el primero cargado) y, si no
 * hay, en partes enteras por unidad recorriendo los ítems en ese mismo orden.
 * Lo que no se puede repartir (menos de 1 centavo por unidad de cualquier
 * ítem) queda informado en `diferenciaRedondeo`. Nunca deja un costo final
 * por debajo del costo base (CHECK CompraItem.costoUnitarioFinal ≥ costoUnitario).
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

export interface CostoFinalItem {
  cantidad: number;
  costoUnitario: number;
  /** subtotal del ítem (cantidad × costo unitario). */
  subtotal: number;
  /** Comisión del pasista por unidad (proporcional al precio), a centavos. */
  comisionPorUnidad: number;
  /** Gastos extras por unidad (iguales para todas las unidades), a centavos. */
  gastosPorUnidad: number;
  /** Centavos de redondeo asignados a este ítem, por unidad (normalmente 0). */
  ajustePorUnidad: number;
  /** costo + comisión/u + gastos/u + ajuste/u. */
  costoUnitarioFinal: number;
  /** cantidad × costoUnitarioFinal. */
  subtotalFinal: number;
}

export interface CostosFinales {
  subtotal: number;
  descuento: number;
  /** subtotal − descuento (= Compra.total). */
  total: number;
  /** total ÷ subtotal (1 sin subtotal). */
  factorDescuento: number;
  comisionPorcentaje: number | null;
  comision: number;
  gastos: number;
  /** total + comisión + gastos. */
  costoFinalTotal: number;
  unidades: number;
  /** gastos ÷ unidades a centavos (lo mismo para todas las unidades). */
  gastosPorUnidad: number;
  /** costoFinalTotal ÷ unidades, a centavos (0 sin unidades). */
  costoUnitarioFinalPromedio: number;
  /** Σ subtotalFinal de los ítems. */
  sumaSubtotalesFinales: number;
  /**
   * (subtotal + comisión + gastos) − Σ subtotalFinal: centavos de redondeo
   * que no se pudieron repartir sin romper el "por unidad". Casi siempre 0.
   */
  diferenciaRedondeo: number;
  /** Mismo orden que `items`. */
  items: CostoFinalItem[];
}

/** "1.234,5" / "1234.5" / 1234.5 → 123450 centavos. */
function aCentavos(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const aPesos = (centavos: number) => centavos / 100;

/** División entera redondeada mitad hacia arriba (num ≥ 0, den > 0), exacta con enteros grandes. */
function divRedondeada(num: bigint, den: bigint): number {
  return Number((2n * num + den) / (2n * den));
}

/** Truncado hacia cero (para repartir residuos negativos y positivos por igual). */
const truncar = (n: number) => (n < 0 ? Math.ceil(n) : Math.floor(n));

export function calcularCostosFinales(c: EntradaCostosCompra): CostosFinales {
  const items = c.items.map((i) => ({
    cantidad: Number.isInteger(i.cantidad) && i.cantidad > 0 ? i.cantidad : 0,
    costo: Math.max(0, aCentavos(i.costoUnitario)),
  }));
  const subtotal = items.reduce((a, i) => a + i.cantidad * i.costo, 0);
  const descuento = Math.min(Math.max(0, aCentavos(c.descuento)), subtotal);
  const total = subtotal - descuento;
  // % con 2 decimales en centésimos enteros: total × pct ÷ 10.000 es exacto hasta el redondeo.
  const pct =
    c.comisionPorcentaje === null || c.comisionPorcentaje === ""
      ? null
      : Math.round(Number(String(c.comisionPorcentaje).replace(",", ".")) * 100);
  const comisionPorcentaje = pct !== null && Number.isFinite(pct) && pct > 0 ? pct : null;
  const p = comisionPorcentaje ?? 0;
  const comision = Math.round((total * p) / 10_000);
  const gastos = c.gastos.reduce<number>((a, g) => a + aCentavos(g), 0);
  const costoFinalTotal = total + comision + gastos;
  const unidades = items.reduce((a, i) => a + i.cantidad, 0);
  const gastosPorUnidad = unidades > 0 ? Math.round(gastos / unidades) : 0;

  // pasista/u = costo × (total/subtotal) × pct/10.000, con BigInt para no perder precisión.
  const comisionUnidad = (costo: number) =>
    subtotal > 0
      ? divRedondeada(BigInt(costo) * BigInt(total) * BigInt(p), BigInt(subtotal) * 10_000n)
      : divRedondeada(BigInt(costo) * BigInt(p), 10_000n);

  const calculados = items.map((i) => ({
    ...i,
    comisionPorUnidad: comisionUnidad(i.costo),
    gastosPorUnidad: i.cantidad > 0 ? gastosPorUnidad : 0,
    ajuste: 0,
  }));

  // Residuo de redondeo (en centavos) respecto de la comisión + gastos a repartir.
  const repartido = calculados.reduce(
    (a, i) => a + i.cantidad * (i.comisionPorUnidad + i.gastosPorUnidad),
    0,
  );
  let residuo = unidades > 0 ? comision + gastos - repartido : 0;
  if (residuo !== 0) {
    const orden = calculados
      .map((i, n) => ({ i, n }))
      .filter(({ i }) => i.cantidad > 0)
      .sort((a, b) => b.i.cantidad * b.i.costo - a.i.cantidad * a.i.costo || a.n - b.n);
    // Lo que se le puede sacar a un ítem por unidad sin quedar debajo del costo base.
    const minimo = (i: (typeof calculados)[number]) => -(i.comisionPorUnidad + i.gastosPorUnidad);
    const exacto = orden.find(
      ({ i }) => residuo % i.cantidad === 0 && residuo / i.cantidad >= minimo(i),
    );
    if (exacto) {
      exacto.i.ajuste = residuo / exacto.i.cantidad;
      residuo = 0;
    } else {
      for (const { i } of orden) {
        const k = Math.max(truncar(residuo / i.cantidad), minimo(i) - i.ajuste);
        if (k === 0) continue;
        i.ajuste += k;
        residuo -= k * i.cantidad;
        if (residuo === 0) break;
      }
    }
  }

  const salida = calculados.map((i) => {
    const final = i.costo + i.comisionPorUnidad + i.gastosPorUnidad + i.ajuste;
    return {
      cantidad: i.cantidad,
      costoUnitario: aPesos(i.costo),
      subtotal: aPesos(i.cantidad * i.costo),
      comisionPorUnidad: aPesos(i.comisionPorUnidad),
      gastosPorUnidad: aPesos(i.gastosPorUnidad),
      ajustePorUnidad: aPesos(i.ajuste),
      costoUnitarioFinal: aPesos(final),
      subtotalFinal: aPesos(i.cantidad * final),
    };
  });
  const sumaFinales = calculados.reduce(
    (a, i) => a + i.cantidad * (i.costo + i.comisionPorUnidad + i.gastosPorUnidad + i.ajuste),
    0,
  );

  return {
    subtotal: aPesos(subtotal),
    descuento: aPesos(descuento),
    total: aPesos(total),
    factorDescuento: subtotal > 0 ? total / subtotal : 1,
    comisionPorcentaje: comisionPorcentaje === null ? null : comisionPorcentaje / 100,
    comision: aPesos(comision),
    gastos: aPesos(gastos),
    costoFinalTotal: aPesos(costoFinalTotal),
    unidades,
    gastosPorUnidad: aPesos(gastosPorUnidad),
    costoUnitarioFinalPromedio: unidades > 0 ? aPesos(Math.round(costoFinalTotal / unidades)) : 0,
    sumaSubtotalesFinales: aPesos(sumaFinales),
    diferenciaRedondeo: unidades > 0 ? aPesos(subtotal + comision + gastos - sumaFinales) : 0,
    items: salida,
  };
}

/** Comisión del pasista por defecto (Configuracion "compras"), en %. */
export const COMISION_PASISTA_DEFAULT = 10;

// =============================================================================
// Compras en USDT (Compra.costosEnUsdt, desde 2026-10-30)
// =============================================================================
//
// Lo que se carga (costo de cada ítem y gastos extras) está en USDT y el costo
// final se calcula EN USDT con `calcularCostosFinales`: lo que se ve en Compras
// sale directo de lo tipeado, sin ir y volver de pesos. Los pesos se derivan
// UNA sola vez con la cotización guardada en la compra (tipoCambioUSDT):
//
//   costo en pesos     = ROUND(costo USDT × cotización, 2)
//   gasto en pesos     = ROUND(gasto USDT × cotización, 2)
//   costo final pesos  = costo en pesos + ROUND((final USDT − costo USDT) × cotización, 2)
//
// Así el costo final en pesos (el que toman las ventas para la ganancia) es
// el final en USDT × cotización (± 1 centavo) y nunca queda debajo del costo
// base (CHECK). Las columnas en pesos de la compra (subtotal, comisión,
// gastos, costo final total) salen de `calcularCostosFinales` sobre los pesos
// derivados, como siempre: así se cumplen los CHECK y triggers de la DB.

/** USDT → pesos con la cotización (pesos por USDT), a centavos, mitad hacia arriba. */
export function usdtAPesos(usdt: string | number, tipoCambio: string | number): number {
  const u = aCentavos(usdt);
  const t = aCentavos(tipoCambio);
  // u/100 × t/100 pesos = u × t / 100 centavos.
  const centavos = divRedondeada(BigInt(Math.abs(u)) * BigInt(t), 100n);
  return aPesos(u < 0 ? -centavos : centavos);
}

/**
 * Pesos → moneda (USDT o dólar) con su cotización (pesos por unidad), a
 * centavos, mitad hacia arriba. Para compras anteriores cargadas en pesos y
 * para mostrar el costo final en dólares.
 */
export function pesosAMoneda(pesos: string | number, tipoCambio: string | number): number {
  const p = aCentavos(pesos);
  const t = aCentavos(tipoCambio);
  if (t <= 0) return 0;
  // p/100 ÷ t/100 USDT = p / t USDT = p × 100 / t centavos.
  const centavos = divRedondeada(BigInt(Math.abs(p)) * 100n, BigInt(t));
  return aPesos(p < 0 ? -centavos : centavos);
}

export interface EntradaCostosCompraUsdt {
  items: { cantidad: number; costoUnitarioUSDT: string | number }[];
  comisionPorcentaje: string | number | null;
  /**
   * Gastos vigentes: el monto en USDT y, si ya está guardado, el monto en
   * pesos (manda el guardado: la DB verifica que los gastos en pesos sumen).
   */
  gastos: { montoUSDT: string | number; monto?: string | number | null }[];
  /** Pesos por USDT (snapshot de la compra). */
  tipoCambioUSDT: string | number;
}

export interface CostosCompraUsdt {
  /** Lo que se muestra: todo en USDT. */
  usdt: CostosFinales;
  /** Columnas en pesos de la compra. */
  pesos: CostosFinales;
  /** Por ítem (mismo orden), en pesos: costo base y costo final. */
  itemsPesos: { costoUnitario: number; costoUnitarioFinal: number }[];
}

export function calcularCostosCompraUsdt(c: EntradaCostosCompraUsdt): CostosCompraUsdt {
  const usdt = calcularCostosFinales({
    items: c.items.map((i) => ({ cantidad: i.cantidad, costoUnitario: i.costoUnitarioUSDT })),
    comisionPorcentaje: c.comisionPorcentaje,
    gastos: c.gastos.map((g) => g.montoUSDT),
  });
  const costosPesos = c.items.map((i) => usdtAPesos(i.costoUnitarioUSDT, c.tipoCambioUSDT));
  const pesos = calcularCostosFinales({
    items: c.items.map((i, n) => ({ cantidad: i.cantidad, costoUnitario: costosPesos[n]! })),
    comisionPorcentaje: c.comisionPorcentaje,
    gastos: c.gastos.map((g) =>
      g.monto !== null && g.monto !== undefined && g.monto !== ""
        ? g.monto
        : usdtAPesos(g.montoUSDT, c.tipoCambioUSDT),
    ),
  });
  const itemsPesos = usdt.items.map((u, n) => {
    const base = costosPesos[n]!;
    const extras = usdtAPesos(
      aPesos(aCentavos(u.costoUnitarioFinal) - aCentavos(u.costoUnitario)),
      c.tipoCambioUSDT,
    );
    return { costoUnitario: base, costoUnitarioFinal: aPesos(aCentavos(base) + aCentavos(extras)) };
  });
  return { usdt, pesos, itemsPesos };
}

export interface VistaCostosUsdt {
  /** Todo en USDT: lo que se muestra en Compras. */
  costos: CostosFinales;
  /**
   * Costo final por unidad de cada ítem en USDT. En compras en USDT es el
   * calculado; en las anteriores, el final guardado en pesos ÷ cotización.
   */
  finalesUsdt: number[];
  /** true = compra anterior calculada en pesos: los USDT son equivalentes (≈). */
  aproximado: boolean;
}

/**
 * Costos de una compra en USDT para mostrar. En USDT (costosEnUsdt), con lo
 * cargado; en una compra anterior (en pesos), pasando cada monto cargado a
 * USDT con la cotización (aproximado).
 */
export function vistaCostosUsdt(c: {
  costosEnUsdt: boolean;
  /** Pesos por USDT (la de la compra o, si no tiene, la vigente). */
  tipoCambioUSDT: string | number;
  comisionPorcentaje: string | number | null;
  descuento?: string | number;
  items: {
    cantidad: number;
    costoUnitario: string | number;
    costoUnitarioUSDT: string | number | null;
    costoUnitarioFinal: string | number;
  }[];
  gastos: { monto: string | number; montoUSDT: string | number | null }[];
}): VistaCostosUsdt {
  const enUsdt =
    c.costosEnUsdt &&
    c.items.every((i) => i.costoUnitarioUSDT !== null && i.costoUnitarioUSDT !== "");
  const a = (pesos: string | number) => pesosAMoneda(pesos, c.tipoCambioUSDT);
  const costos = calcularCostosFinales({
    items: c.items.map((i) => ({
      cantidad: i.cantidad,
      costoUnitario: enUsdt ? i.costoUnitarioUSDT! : a(i.costoUnitario),
    })),
    descuento: enUsdt ? 0 : a(c.descuento ?? 0),
    comisionPorcentaje: c.comisionPorcentaje,
    gastos: c.gastos.map((g) =>
      g.montoUSDT !== null && g.montoUSDT !== "" ? g.montoUSDT : a(g.monto),
    ),
  });
  return {
    costos,
    finalesUsdt: c.items.map((i, n) =>
      enUsdt ? costos.items[n]!.costoUnitarioFinal : a(i.costoUnitarioFinal),
    ),
    aproximado: !enUsdt,
  };
}
