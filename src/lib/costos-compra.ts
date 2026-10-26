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
