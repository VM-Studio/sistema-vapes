import { Prisma, type TipoVenta } from "@prisma/client";
import { getDaysInMonth, parseISO } from "date-fns";

import { diaEn, limitesRango, ZONA_DEFAULT } from "@/lib/zona-horaria";

/**
 * GANANCIA POR UNIDAD de un vendedor (puro: lo usan el servicio, la UI y los tests).
 *
 * Cada venta CONFIRMADA del vendedor en el mes cae en una de 4 categorías —
 * tipo de venta (UNITARIA = minorista, MAYORISTA) × cliente nuevo
 * (Venta.clienteNuevo: el cliente se dio de alta con esa venta) — y gana
 * unidades × tarifa de la categoría.
 *
 * Criterio de devoluciones (garantías, ver devolucion.service): una devolución
 * REGISTRADA vinculada a una venta CONFIRMADA del vendedor descuenta las
 * unidades devueltas × la tarifa de la categoría de esa venta, en el MES DE LA
 * DEVOLUCIÓN (hora argentina). Así un mes ya liquidado no cambia nunca: si el
 * cliente devuelve en noviembre un vape de octubre, se descuenta en noviembre.
 * Las ventas anuladas no cuentan (y sus devoluciones tampoco, para no
 * descontar dos veces). El total del mes nunca es negativo.
 */

export const CATEGORIAS_GANANCIA = [
  "MINORISTA",
  "MAYORISTA",
  "MINORISTA_NUEVO",
  "MAYORISTA_NUEVO",
] as const;
export type CategoriaGanancia = (typeof CATEGORIAS_GANANCIA)[number];

export const ETIQUETA_CATEGORIA: Record<CategoriaGanancia, string> = {
  MINORISTA: "Minorista",
  MAYORISTA: "Mayorista",
  MINORISTA_NUEVO: "Minorista · cliente nuevo",
  MAYORISTA_NUEVO: "Mayorista · cliente nuevo",
};

/** $ por unidad de cada categoría (texto decimal, "1500.00"). */
export interface Tarifas {
  minorista: string;
  mayorista: string;
  minoristaNuevo: string;
  mayoristaNuevo: string;
}

const CAMPO_TARIFA: Record<CategoriaGanancia, keyof Tarifas> = {
  MINORISTA: "minorista",
  MAYORISTA: "mayorista",
  MINORISTA_NUEVO: "minoristaNuevo",
  MAYORISTA_NUEVO: "mayoristaNuevo",
};

export function categoriaDe(tipo: TipoVenta, clienteNuevo: boolean): CategoriaGanancia {
  if (tipo === "MAYORISTA") return clienteNuevo ? "MAYORISTA_NUEVO" : "MAYORISTA";
  return clienteNuevo ? "MINORISTA_NUEVO" : "MINORISTA";
}

export const tarifaDe = (t: Tarifas, c: CategoriaGanancia): string => t[CAMPO_TARIFA[c]];

export interface VentaParaGanancia {
  id: string;
  codigo: string;
  fecha: Date;
  tipo: TipoVenta;
  clienteNuevo: boolean;
  cliente: string;
  unidades: number;
  total: string;
}

export interface DevolucionParaGanancia {
  id: string;
  codigo: string;
  fecha: Date;
  ventaId: string;
  ventaCodigo: string;
  tipo: TipoVenta;
  clienteNuevo: boolean;
  cliente: string;
  unidades: number;
}

/** Una fila del detalle: una venta (+) o una devolución (−). */
export interface FilaGanancia {
  tipo: "VENTA" | "DEVOLUCION";
  id: string;
  codigo: string;
  /** La venta (la misma fila si es VENTA; la original si es DEVOLUCION). */
  ventaId: string;
  ventaCodigo: string;
  fecha: Date;
  cliente: string;
  categoria: CategoriaGanancia;
  /** Negativas en las devoluciones. */
  unidades: number;
  tarifa: string;
  ganancia: string;
  /** Total de la venta ($); "0.00" en las devoluciones. */
  totalVenta: string;
}

export interface ResumenCategoria {
  categoria: CategoriaGanancia;
  ventas: number;
  /** Unidades vendidas (sin restar devoluciones). */
  unidades: number;
  unidadesDevueltas: number;
  tarifa: string;
  monto: string;
  totalVendido: string;
}

export interface CalculoGanancia {
  tarifas: Tarifas;
  categorias: ResumenCategoria[];
  /** Ventas y devoluciones, la más reciente primero. */
  filas: FilaGanancia[];
  total: string;
  cantidadVentas: number;
  /** Vendidas − devueltas. */
  unidades: number;
  totalVendido: string;
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const CERO = D(0);

export function calcularGanancia(
  tarifas: Tarifas,
  ventas: VentaParaGanancia[],
  devoluciones: DevolucionParaGanancia[],
): CalculoGanancia {
  const acc = new Map(
    CATEGORIAS_GANANCIA.map((c) => [
      c,
      { ventas: 0, unidades: 0, devueltas: 0, monto: CERO, vendido: CERO },
    ]),
  );
  const filas: FilaGanancia[] = [];
  for (const v of ventas) {
    const categoria = categoriaDe(v.tipo, v.clienteNuevo);
    const tarifa = tarifaDe(tarifas, categoria);
    const ganancia = D(tarifa).times(v.unidades);
    const a = acc.get(categoria)!;
    a.ventas += 1;
    a.unidades += v.unidades;
    a.monto = a.monto.plus(ganancia);
    a.vendido = a.vendido.plus(v.total);
    filas.push({
      tipo: "VENTA",
      id: v.id,
      codigo: v.codigo,
      ventaId: v.id,
      ventaCodigo: v.codigo,
      fecha: v.fecha,
      cliente: v.cliente,
      categoria,
      unidades: v.unidades,
      tarifa: D(tarifa).toFixed(2),
      ganancia: ganancia.toFixed(2),
      totalVenta: D(v.total).toFixed(2),
    });
  }
  for (const d of devoluciones) {
    if (d.unidades <= 0) continue;
    const categoria = categoriaDe(d.tipo, d.clienteNuevo);
    const tarifa = tarifaDe(tarifas, categoria);
    const descuento = D(tarifa).times(d.unidades);
    const a = acc.get(categoria)!;
    a.devueltas += d.unidades;
    a.monto = a.monto.minus(descuento);
    filas.push({
      tipo: "DEVOLUCION",
      id: d.id,
      codigo: d.codigo,
      ventaId: d.ventaId,
      ventaCodigo: d.ventaCodigo,
      fecha: d.fecha,
      cliente: d.cliente,
      categoria,
      unidades: -d.unidades,
      tarifa: D(tarifa).toFixed(2),
      ganancia: descuento.negated().toFixed(2),
      totalVenta: "0.00",
    });
  }
  filas.sort((x, y) => y.fecha.getTime() - x.fecha.getTime() || (x.codigo < y.codigo ? 1 : -1));
  const categorias = CATEGORIAS_GANANCIA.map((c) => {
    const a = acc.get(c)!;
    return {
      categoria: c,
      ventas: a.ventas,
      unidades: a.unidades,
      unidadesDevueltas: a.devueltas,
      tarifa: D(tarifaDe(tarifas, c)).toFixed(2),
      monto: a.monto.toFixed(2),
      totalVendido: a.vendido.toFixed(2),
    };
  });
  const suma = categorias.reduce((s, c) => s.plus(c.monto), CERO);
  return {
    tarifas: {
      minorista: D(tarifas.minorista).toFixed(2),
      mayorista: D(tarifas.mayorista).toFixed(2),
      minoristaNuevo: D(tarifas.minoristaNuevo).toFixed(2),
      mayoristaNuevo: D(tarifas.mayoristaNuevo).toFixed(2),
    },
    categorias,
    filas,
    total: Prisma.Decimal.max(suma, CERO).toFixed(2),
    cantidadVentas: ventas.length,
    unidades: categorias.reduce((s, c) => s + c.unidades - c.unidadesDevueltas, 0),
    totalVendido: categorias.reduce((s, c) => s.plus(c.totalVendido), CERO).toFixed(2),
  };
}

// -----------------------------------------------------------------------------
// Meses (hora argentina)
// -----------------------------------------------------------------------------

/** "YYYY-MM". */
export type Mes = string;

export const esMes = (s: unknown): s is Mes =>
  typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Mes argentino de un instante. */
export const mesDe = (instante: Date): Mes => diaEn(instante, ZONA_DEFAULT).slice(0, 7);

export function sumarMeses(mes: Mes, n: number): Mes {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Instantes UTC [inicio, fin) del mes en hora argentina. */
export function limitesMes(mes: Mes): { inicio: Date; fin: Date } {
  const ultimo = getDaysInMonth(parseISO(`${mes}-01`));
  return limitesRango(`${mes}-01`, `${mes}-${String(ultimo).padStart(2, "0")}`, ZONA_DEFAULT);
}

/** DATE de Postgres del mes (primer día, medianoche UTC). */
export const fechaDeMes = (mes: Mes): Date => new Date(`${mes}-01T00:00:00.000Z`);
export const mesDeFecha = (d: Date): Mes => d.toISOString().slice(0, 7);

const NOMBRES_MES = [
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

/** "2026-10" → "octubre 2026". */
export function nombreMes(mes: Mes): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return `${NOMBRES_MES[m - 1]} ${a}`;
}

/** "2026-10" → "Octubre 2026". */
export const nombreMesTitulo = (mes: Mes) => {
  const n = nombreMes(mes);
  return n.charAt(0).toUpperCase() + n.slice(1);
};
