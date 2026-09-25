import { MedioPago, Prisma, TipoMovimiento } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { ahora } from "@/lib/reloj";
import {
  diaEn,
  diasEntre,
  limitesRango,
  rangoComparable,
  sumarDias,
  type DiaISO,
  type Rango,
} from "@/lib/zona-horaria";
import { obtenerConfigFinanzas, obtenerZonaHoraria } from "@/server/services/configuracion.service";
import { nombreCompleto } from "@/server/services/producto.service";
import { ventasPorVendedor as ventasPorVendedorBase } from "@/server/services/venta.service";

/**
 * REPORTES — consultas analíticas. Reglas:
 *  - Nunca se traen ventas a Node: todo se agrega en PostgreSQL. Lo que
 *    alcanza con ResumenDiario (KPIs, series, medios, depósitos) sale de ahí;
 *    el resto, de $queryRaw sobre índices.
 *  - Todo rango es de DÍAS COMPLETOS en Configuracion.timezone: [desde 00:00,
 *    hasta+1 00:00) convertido a UTC (las columnas guardan UTC sin zona).
 *  - El resultado de cada $queryRaw se valida con Zod (no viene tipado).
 *  - `usuarioId`: el empleado sin REPORTES ve solo lo propio; como
 *    ResumenDiario no tiene esa dimensión, esas consultas van a las tablas.
 */

export interface FiltroReporte extends Rango {
  depositoId?: string;
  /** Solo las ventas de este vendedor. */
  usuarioId?: string;
  categoriaId?: string;
}

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const CERO = D(0);
const dec = (d: Prisma.Decimal) => d.toFixed(2);

/** numeric → Decimal (null → 0). */
const zDec = z
  .custom<Prisma.Decimal | number | string | null>(
    (v) =>
      v === null || Prisma.Decimal.isDecimal(v) || typeof v === "number" || typeof v === "string",
  )
  .transform((v) => (v === null ? CERO : D(v)));
/** count (int8) / int4 / SUM de enteros (numeric) → number (null → 0). */
const zInt = z
  .custom<bigint | number | Prisma.Decimal | null>(
    (v) =>
      v === null || typeof v === "bigint" || typeof v === "number" || Prisma.Decimal.isDecimal(v),
  )
  .transform((v) => (v === null ? 0 : Number(v.toString())));
const zDate = z.date();

function parsear<T extends z.ZodTypeAny>(schema: T, filas: unknown): z.output<T>[] {
  return z.array(schema).parse(filas);
}

/** Columna timestamp (UTC sin zona) vs. instante: conversión explícita. */
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

async function contexto(f: Rango) {
  const tz = await obtenerZonaHoraria();
  return { tz, ...limitesRango(f.desde, f.hasta, tz) };
}

/** % con 1 decimal; null si no hay base. */
function porcentaje(parte: Prisma.Decimal, base: Prisma.Decimal): number | null {
  if (base.isZero()) return null;
  return parte.div(base).mul(100).toDecimalPlaces(1).toNumber();
}

function delta(actual: Prisma.Decimal, anterior: Prisma.Decimal): number | null {
  if (anterior.isZero()) return null;
  return actual.minus(anterior).div(anterior.abs()).mul(100).toDecimalPlaces(1).toNumber();
}

/** Filtro de depósito sobre ResumenDiario: la fila del depósito o la consolidada. */
const filaResumen = (depositoId?: string) =>
  depositoId ? Prisma.sql`r."depositoId" = ${depositoId}` : Prisma.sql`r."depositoId" IS NULL`;

const filtroVenta = (f: FiltroReporte, alias = "v") => {
  const a = Prisma.raw(alias);
  return Prisma.sql`
    ${f.depositoId ? Prisma.sql`AND ${a}."depositoId" = ${f.depositoId}` : Prisma.empty}
    ${f.usuarioId ? Prisma.sql`AND ${a}."usuarioId" = ${f.usuarioId}` : Prisma.empty}`;
};

// =============================================================================
// KPIs con comparación contra el período anterior equivalente
// =============================================================================

interface Totales {
  ventas: Prisma.Decimal;
  cantidad: number;
  unidades: number;
  costo: Prisma.Decimal;
  gananciaBruta: Prisma.Decimal;
  gastos: Prisma.Decimal;
  devoluciones: Prisma.Decimal;
  gananciaNeta: Prisma.Decimal;
}

const totalesSchema = z.object({
  ventas: zDec,
  cantidad: zInt,
  unidades: zInt,
  costo: zDec,
  ganancia_bruta: zDec,
  gastos: zDec,
  devoluciones: zDec,
  ganancia_neta: zDec,
});

async function totalesPeriodo(f: FiltroReporte, tz: string): Promise<Totales> {
  let crudo: unknown;
  if (!f.usuarioId) {
    // ResumenDiario: una fila por día (la del depósito o la consolidada).
    crudo = await prisma.$queryRaw`
      SELECT COALESCE(SUM(r."totalVentas"), 0) AS ventas,
             COALESCE(SUM(r."cantidadVentas"), 0) AS cantidad,
             COALESCE(SUM(r."unidadesVendidas"), 0) AS unidades,
             COALESCE(SUM(r."costoVentas"), 0) AS costo,
             COALESCE(SUM(r."gananciaBruta"), 0) AS ganancia_bruta,
             COALESCE(SUM(r."totalGastos"), 0) AS gastos,
             COALESCE(SUM(r."devoluciones"), 0) AS devoluciones,
             COALESCE(SUM(r."gananciaNeta"), 0) AS ganancia_neta
      FROM "ResumenDiario" r
      WHERE ${filaResumen(f.depositoId)} AND r."fecha" BETWEEN ${f.desde}::date AND ${f.hasta}::date
    `;
  } else {
    // Solo lo del vendedor: directo de Venta (sin gastos: no son de nadie).
    const { inicio, fin } = limitesRango(f.desde, f.hasta, tz);
    crudo = await prisma.$queryRaw`
      SELECT COALESCE(SUM(v."total"), 0) AS ventas, COUNT(*) AS cantidad,
             COALESCE(SUM(u.unidades), 0) AS unidades,
             COALESCE(SUM(v."costoTotal"), 0) AS costo,
             COALESCE(SUM(v."gananciaBruta"), 0) AS ganancia_bruta,
             0 AS gastos, 0 AS devoluciones,
             COALESCE(SUM(v."gananciaBruta"), 0) AS ganancia_neta
      FROM "Venta" v
      LEFT JOIN LATERAL (SELECT SUM(vi."cantidad") AS unidades FROM "VentaItem" vi WHERE vi."ventaId" = v."id") u ON true
      WHERE v."estado" = 'CONFIRMADA' AND v."fecha" >= ${utc(inicio)} AND v."fecha" < ${utc(fin)}
        ${filtroVenta(f)}
    `;
  }
  const [t] = parsear(totalesSchema, crudo);
  return {
    ventas: t!.ventas,
    cantidad: t!.cantidad,
    unidades: t!.unidades,
    costo: t!.costo,
    gananciaBruta: t!.ganancia_bruta,
    gastos: t!.gastos,
    devoluciones: t!.devoluciones,
    gananciaNeta: t!.ganancia_neta,
  };
}

export interface Kpi {
  actual: string;
  anterior: string;
  /** Variación % contra el período anterior (null: el anterior fue 0). */
  delta: number | null;
}

export interface Kpis {
  periodo: Rango;
  periodoAnterior: Rango;
  ventas: Kpi;
  cantidadVentas: Kpi;
  unidades: Kpi;
  ticketPromedio: Kpi;
  gananciaBruta: Kpi;
  gastos: Kpi;
  gananciaNeta: Kpi;
  /** Margen bruto % (delta en puntos porcentuales). */
  margen: { actual: number | null; anterior: number | null; delta: number | null };
  devoluciones: Kpi;
}

/**
 * KPIs del período y del período anterior equivalente: "este mes" (1 → hoy)
 * contra el mismo tramo del mes anterior; un mes completo contra el mes
 * anterior completo; cualquier otro rango contra los N días previos.
 */
export async function kpis(f: FiltroReporte): Promise<Kpis> {
  const tz = await obtenerZonaHoraria();
  const anterior = rangoComparable(f);
  const [a, b] = await Promise.all([
    totalesPeriodo(f, tz),
    totalesPeriodo({ ...f, ...anterior }, tz),
  ]);
  const kpi = (x: Prisma.Decimal, y: Prisma.Decimal): Kpi => ({
    actual: dec(x),
    anterior: dec(y),
    delta: delta(x, y),
  });
  const ticket = (t: Totales) => (t.cantidad ? t.ventas.div(t.cantidad) : CERO);
  const margenA = porcentaje(a.gananciaBruta, a.ventas);
  const margenB = porcentaje(b.gananciaBruta, b.ventas);
  return {
    periodo: { desde: f.desde, hasta: f.hasta },
    periodoAnterior: anterior,
    ventas: kpi(a.ventas, b.ventas),
    cantidadVentas: kpi(D(a.cantidad), D(b.cantidad)),
    unidades: kpi(D(a.unidades), D(b.unidades)),
    ticketPromedio: kpi(ticket(a).toDecimalPlaces(2), ticket(b).toDecimalPlaces(2)),
    gananciaBruta: kpi(a.gananciaBruta, b.gananciaBruta),
    gastos: kpi(a.gastos, b.gastos),
    gananciaNeta: kpi(a.gananciaNeta, b.gananciaNeta),
    margen: {
      actual: margenA,
      anterior: margenB,
      delta:
        margenA !== null && margenB !== null ? Math.round((margenA - margenB) * 10) / 10 : null,
    },
    devoluciones: kpi(a.devoluciones, b.devoluciones),
  };
}

// =============================================================================
// Series
// =============================================================================

export type Granularidad = "dia" | "semana" | "mes";

/** Granularidad razonable para el largo del rango (el dashboard la elige sola). */
export function granularidadPara(r: Rango): Granularidad {
  const n = diasEntre(r.desde, r.hasta);
  return n <= 45 ? "dia" : n <= 190 ? "semana" : "mes";
}

const serieSchema = z.object({
  periodo: zDate,
  ventas: zDec,
  cantidad: zInt,
  costo: zDec,
  ganancia_bruta: zDec,
  gastos: zDec,
  ganancia_neta: zDec,
});

export interface PuntoSerie {
  /** Inicio del período "YYYY-MM-DD" (semanas: lunes). */
  periodo: DiaISO;
  ventas: string;
  cantidad: number;
  costo: string;
  gananciaBruta: string;
  gastos: string;
  gananciaNeta: string;
}

/**
 * Ventas, costo, ganancia bruta, gastos y neta por día / semana / mes, con
 * los períodos sin ventas en cero (el gráfico no "salta" días).
 */
export async function serieTemporal(
  f: FiltroReporte & { granularidad?: Granularidad },
): Promise<PuntoSerie[]> {
  const gran = f.granularidad ?? granularidadPara(f);
  const unidad = Prisma.raw(`'${gran === "dia" ? "day" : gran === "semana" ? "week" : "month"}'`);
  const paso = Prisma.raw(`'1 ${gran === "dia" ? "day" : gran === "semana" ? "week" : "month"}'`);
  let crudo: unknown;
  if (!f.usuarioId) {
    crudo = await prisma.$queryRaw`
      WITH periodos AS (
        SELECT gs::date AS periodo
        FROM generate_series(date_trunc(${unidad}, ${f.desde}::date::timestamp), ${f.hasta}::date::timestamp, interval ${paso}) gs
      ),
      datos AS (
        SELECT date_trunc(${unidad}, r."fecha"::timestamp)::date AS periodo,
               SUM(r."totalVentas") AS ventas, SUM(r."cantidadVentas") AS cantidad,
               SUM(r."costoVentas") AS costo, SUM(r."gananciaBruta") AS ganancia_bruta,
               SUM(r."totalGastos") AS gastos, SUM(r."gananciaNeta") AS ganancia_neta
        FROM "ResumenDiario" r
        WHERE ${filaResumen(f.depositoId)} AND r."fecha" BETWEEN ${f.desde}::date AND ${f.hasta}::date
        GROUP BY 1
      )
      SELECT p.periodo, d.ventas, d.cantidad, d.costo, d.ganancia_bruta, d.gastos, d.ganancia_neta
      FROM periodos p LEFT JOIN datos d USING (periodo)
      ORDER BY p.periodo
    `;
  } else {
    const tz = await obtenerZonaHoraria();
    const { inicio, fin } = limitesRango(f.desde, f.hasta, tz);
    crudo = await prisma.$queryRaw`
      WITH periodos AS (
        SELECT gs::date AS periodo
        FROM generate_series(date_trunc(${unidad}, ${f.desde}::date::timestamp), ${f.hasta}::date::timestamp, interval ${paso}) gs
      ),
      datos AS (
        SELECT date_trunc(${unidad}, (v."fecha" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date::timestamp)::date AS periodo,
               SUM(v."total") AS ventas, COUNT(*) AS cantidad, SUM(v."costoTotal") AS costo,
               SUM(v."gananciaBruta") AS ganancia_bruta, 0 AS gastos, SUM(v."gananciaBruta") AS ganancia_neta
        FROM "Venta" v
        WHERE v."estado" = 'CONFIRMADA' AND v."fecha" >= ${utc(inicio)} AND v."fecha" < ${utc(fin)}
          ${filtroVenta(f)}
        GROUP BY 1
      )
      SELECT p.periodo, d.ventas, d.cantidad, d.costo, d.ganancia_bruta, d.gastos, d.ganancia_neta
      FROM periodos p LEFT JOIN datos d USING (periodo)
      ORDER BY p.periodo
    `;
  }
  return parsear(serieSchema, crudo).map((r) => ({
    periodo: r.periodo.toISOString().slice(0, 10),
    ventas: dec(r.ventas),
    cantidad: r.cantidad,
    costo: dec(r.costo),
    gananciaBruta: dec(r.ganancia_bruta),
    gastos: dec(r.gastos),
    gananciaNeta: dec(r.ganancia_neta),
  }));
}

// =============================================================================
// Cortes de ventas
// =============================================================================

/**
 * Lo COBRADO en el período por medio de pago (por fecha de cobro, incluye
 * cobros de cuenta corriente), más el efectivo cobrado fuera de caja.
 */
export async function ventasPorMedioPago(f: FiltroReporte): Promise<{
  medios: { medioPago: MedioPago; total: string; porcentaje: number | null }[];
  total: string;
  efectivoFueraDeCaja: string;
}> {
  const { tz, inicio, fin } = await contexto(f);
  let crudo: unknown;
  if (!f.usuarioId) {
    crudo = await prisma.$queryRaw`
      SELECT m.key AS medio, SUM(m.value::numeric) AS total
      FROM "ResumenDiario" r, jsonb_each_text(r."totalPorMedioPago") m
      WHERE ${filaResumen(f.depositoId)} AND r."fecha" BETWEEN ${f.desde}::date AND ${f.hasta}::date
      GROUP BY m.key ORDER BY total DESC
    `;
  } else {
    crudo = await prisma.$queryRaw`
      SELECT p."medioPago"::text AS medio, SUM(p."monto") AS total
      FROM "PagoVenta" p JOIN "Venta" v ON v."id" = p."ventaId"
      WHERE NOT p."anulado" AND p."fecha" >= ${utc(inicio)} AND p."fecha" < ${utc(fin)} ${filtroVenta(f)}
      GROUP BY 1 ORDER BY total DESC
    `;
  }
  const medios = parsear(z.object({ medio: z.enum(MedioPago), total: zDec }), crudo);
  const total = medios.reduce((a, m) => a.plus(m.total), CERO);
  const fuera = await efectivoFueraDeCaja(f, tz);
  return {
    medios: medios.map((m) => ({
      medioPago: m.medio,
      total: dec(m.total),
      porcentaje: porcentaje(m.total, total),
    })),
    total: dec(total),
    efectivoFueraDeCaja: fuera.total,
  };
}

/** Efectivo cobrado sin caja abierta (PagoVenta EFECTIVO con cajaId null). */
export async function efectivoFueraDeCaja(
  f: FiltroReporte,
  tzDado?: string,
): Promise<{ total: string; cantidad: number }> {
  const tz = tzDado ?? (await obtenerZonaHoraria());
  const { inicio, fin } = limitesRango(f.desde, f.hasta, tz);
  const [r] = parsear(
    z.object({ total: zDec, n: zInt }),
    await prisma.$queryRaw`
      SELECT SUM(p."monto") AS total, COUNT(*) AS n
      FROM "PagoVenta" p JOIN "Venta" v ON v."id" = p."ventaId"
      WHERE NOT p."anulado" AND p."medioPago" = 'EFECTIVO' AND p."cajaId" IS NULL
        AND p."fecha" >= ${utc(inicio)} AND p."fecha" < ${utc(fin)} ${filtroVenta(f)}
    `,
  );
  return { total: dec(r!.total), cantidad: r!.n };
}

export async function ventasPorDeposito(f: FiltroReporte) {
  const filas = parsear(
    z.object({
      deposito_id: z.string(),
      deposito: z.string(),
      cantidad: zInt,
      unidades: zInt,
      ventas: zDec,
      ganancia_bruta: zDec,
      gastos: zDec,
      ganancia_neta: zDec,
    }),
    await prisma.$queryRaw`
      SELECT d."id" AS deposito_id, d."nombre" AS deposito,
             COALESCE(SUM(r."cantidadVentas"), 0) AS cantidad, COALESCE(SUM(r."unidadesVendidas"), 0) AS unidades,
             COALESCE(SUM(r."totalVentas"), 0) AS ventas, COALESCE(SUM(r."gananciaBruta"), 0) AS ganancia_bruta,
             COALESCE(SUM(r."totalGastos"), 0) AS gastos, COALESCE(SUM(r."gananciaNeta"), 0) AS ganancia_neta
      FROM "Deposito" d
      LEFT JOIN "ResumenDiario" r ON r."depositoId" = d."id" AND r."fecha" BETWEEN ${f.desde}::date AND ${f.hasta}::date
      WHERE d."activo" OR r."id" IS NOT NULL
      GROUP BY d."id", d."nombre" ORDER BY ventas DESC, d."nombre"
    `,
  );
  const total = filas.reduce((a, x) => a.plus(x.ventas), CERO);
  return filas.map((x) => ({
    depositoId: x.deposito_id,
    deposito: x.deposito,
    cantidad: x.cantidad,
    unidades: x.unidades,
    ventas: dec(x.ventas),
    gananciaBruta: dec(x.ganancia_bruta),
    gastos: dec(x.gastos),
    gananciaNeta: dec(x.ganancia_neta),
    porcentaje: porcentaje(x.ventas, total),
  }));
}

/** Reutiliza el agregado de venta.service (rango inclusivo en instantes). */
export async function ventasPorVendedor(f: FiltroReporte) {
  const { inicio, fin } = await contexto(f);
  const filas = await ventasPorVendedorBase({
    desde: inicio,
    hasta: new Date(fin.getTime() - 1),
    depositoId: f.depositoId,
  });
  return filas.map((x) => ({
    ...x,
    ticketPromedio: dec(x.cantidad ? D(x.total).div(x.cantidad) : CERO),
  }));
}

/** Para saber cuándo vender: las 24 horas del día, en la zona del negocio. */
export async function ventasPorHoraDelDia(f: FiltroReporte) {
  const { tz, inicio, fin } = await contexto(f);
  const filas = parsear(
    z.object({ hora: zInt, cantidad: zInt, total: zDec }),
    await prisma.$queryRaw`
      SELECT h AS hora, COUNT(v."id") AS cantidad, COALESCE(SUM(v."total"), 0) AS total
      FROM generate_series(0, 23) h
      LEFT JOIN "Venta" v ON EXTRACT(HOUR FROM v."fecha" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) = h
        AND v."estado" = 'CONFIRMADA' AND v."fecha" >= ${utc(inicio)} AND v."fecha" < ${utc(fin)}
        ${filtroVenta(f)}
      GROUP BY h ORDER BY h
    `,
  );
  return filas.map((x) => ({ hora: x.hora, cantidad: x.cantidad, total: dec(x.total) }));
}

export const DIAS_SEMANA = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

/** Lunes (1) … domingo (7), con promedio por día (cuántos lunes tuvo el período). */
export async function ventasPorDiaSemana(f: FiltroReporte) {
  const { tz, inicio, fin } = await contexto(f);
  const filas = parsear(
    z.object({ dow: zInt, cantidad: zInt, total: zDec, dias: zInt }),
    await prisma.$queryRaw`
      WITH dias AS (
        SELECT EXTRACT(ISODOW FROM gs)::int AS dow, COUNT(*) AS dias
        FROM generate_series(${f.desde}::date, ${f.hasta}::date, interval '1 day') gs GROUP BY 1
      ),
      ventas AS (
        SELECT EXTRACT(ISODOW FROM v."fecha" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::int AS dow,
               COUNT(*) AS cantidad, SUM(v."total") AS total
        FROM "Venta" v
        WHERE v."estado" = 'CONFIRMADA' AND v."fecha" >= ${utc(inicio)} AND v."fecha" < ${utc(fin)}
          ${filtroVenta(f)}
        GROUP BY 1
      )
      SELECT d.dow, COALESCE(v.cantidad, 0) AS cantidad, COALESCE(v.total, 0) AS total, dias.dias
      FROM generate_series(1, 7) d(dow)
      LEFT JOIN dias USING (dow) LEFT JOIN ventas v USING (dow)
      ORDER BY d.dow
    `,
  );
  return filas.map((x) => ({
    dia: DIAS_SEMANA[x.dow - 1]!,
    cantidad: x.cantidad,
    total: dec(x.total),
    promedio: dec(x.dias ? x.total.div(x.dias).toDecimalPlaces(2) : CERO),
  }));
}

// =============================================================================
// Rankings (unidades y dinero NETOS de devoluciones, descuento prorrateado)
// =============================================================================

/**
 * Líneas vendidas del período. Por ítem:
 *  facturado  = subtotal × (total / subtotal de la venta): prorratea el
 *               descuento global y el redondeo.
 *  devuelto   = Σ DevolucionItem.subtotal (ya a precio efectivo).
 *  neto       = facturado − devuelto; costo neto = costo × (cantidad − devuelta).
 * La subconsulta de devoluciones solo corre para ítems con devoluciones.
 */
function lineasVendidas(f: FiltroReporte, inicio: Date, fin: Date) {
  return Prisma.sql`
    SELECT vi."varianteId",
           vi."cantidad" - vi."cantidadDevuelta" AS unidades,
           vi."subtotal" * CASE WHEN v."subtotal" > 0 THEN v."total" / v."subtotal" ELSE 0 END
             - CASE WHEN vi."cantidadDevuelta" > 0
                    THEN (SELECT COALESCE(SUM(di."subtotal"), 0) FROM "DevolucionItem" di WHERE di."ventaItemId" = vi."id")
                    ELSE 0 END AS facturado,
           (vi."cantidad" - vi."cantidadDevuelta") * vi."costoUnitario" AS costo
    FROM "Venta" v
    JOIN "VentaItem" vi ON vi."ventaId" = v."id"
    WHERE v."estado" = 'CONFIRMADA' AND v."fecha" >= ${utc(inicio)} AND v."fecha" < ${utc(fin)}
      ${filtroVenta(f)}`;
}

export type OrdenRanking = "unidades" | "ganancia" | "facturacion";

const rankingSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  producto: z.string().nullable(),
  tiene_variantes: z.boolean().nullable(),
  categoria: z.string().nullable(),
  unidades: zInt,
  facturacion: zDec,
  costo: zDec,
});

function aRanking(r: z.output<typeof rankingSchema>) {
  const ganancia = r.facturacion.minus(r.costo);
  return {
    id: r.id,
    nombre:
      r.producto !== null && r.tiene_variantes !== null
        ? nombreCompleto(r.producto, r.nombre, r.tiene_variantes)
        : r.nombre,
    producto: r.producto,
    sabor: r.producto !== null ? r.nombre : null,
    categoria: r.categoria,
    unidades: r.unidades,
    facturacion: dec(r.facturacion),
    costo: dec(r.costo),
    ganancia: dec(ganancia),
    margen: porcentaje(ganancia, r.facturacion),
  };
}

export type FilaRanking = ReturnType<typeof aRanking>;

const ordenSql = (orden: OrdenRanking) =>
  Prisma.raw(
    orden === "ganancia"
      ? "SUM(l.facturado - l.costo) DESC"
      : orden === "facturacion"
        ? "SUM(l.facturado) DESC"
        : "SUM(l.unidades) DESC",
  );

/** Sabores (variantes) del período con producto, unidades, facturación, ganancia y margen. */
export async function rankingVariantes(
  f: FiltroReporte & { orden?: OrdenRanking; limit?: number },
): Promise<FilaRanking[]> {
  const { inicio, fin } = await contexto(f);
  const crudo = await prisma.$queryRaw`
    WITH l AS (${lineasVendidas(f, inicio, fin)})
    SELECT va."id", va."nombre", p."nombre" AS producto, p."tieneVariantes" AS tiene_variantes,
           c."nombre" AS categoria,
           SUM(l.unidades) AS unidades, SUM(l.facturado) AS facturacion, SUM(l.costo) AS costo
    FROM l
    JOIN "Variante" va ON va."id" = l."varianteId"
    JOIN "Producto" p ON p."id" = va."productoId"
    JOIN "Categoria" c ON c."id" = p."categoriaId"
    ${f.categoriaId ? Prisma.sql`WHERE p."categoriaId" = ${f.categoriaId}` : Prisma.empty}
    GROUP BY va."id", va."nombre", p."nombre", p."tieneVariantes", c."nombre"
    HAVING SUM(l.unidades) > 0
    ORDER BY ${ordenSql(f.orden ?? "unidades")}, va."nombre"
    LIMIT ${f.limit ?? 50}
  `;
  return parsear(rankingSchema, crudo).map(aRanking);
}

/** Agrupado por producto padre (todos sus sabores). */
export async function rankingProductos(
  f: FiltroReporte & { orden?: OrdenRanking; limit?: number },
): Promise<FilaRanking[]> {
  const { inicio, fin } = await contexto(f);
  const crudo = await prisma.$queryRaw`
    WITH l AS (${lineasVendidas(f, inicio, fin)})
    SELECT p."id", p."nombre", NULL::text AS producto, NULL::boolean AS tiene_variantes,
           c."nombre" AS categoria,
           SUM(l.unidades) AS unidades, SUM(l.facturado) AS facturacion, SUM(l.costo) AS costo
    FROM l
    JOIN "Variante" va ON va."id" = l."varianteId"
    JOIN "Producto" p ON p."id" = va."productoId"
    JOIN "Categoria" c ON c."id" = p."categoriaId"
    ${f.categoriaId ? Prisma.sql`WHERE p."categoriaId" = ${f.categoriaId}` : Prisma.empty}
    GROUP BY p."id", p."nombre", c."nombre"
    HAVING SUM(l.unidades) > 0
    ORDER BY ${ordenSql(f.orden ?? "unidades")}, p."nombre"
    LIMIT ${f.limit ?? 50}
  `;
  return parsear(rankingSchema, crudo).map(aRanking);
}

export async function rankingCategorias(
  f: FiltroReporte & { orden?: OrdenRanking },
): Promise<FilaRanking[]> {
  const { inicio, fin } = await contexto(f);
  const crudo = await prisma.$queryRaw`
    WITH l AS (${lineasVendidas(f, inicio, fin)})
    SELECT c."id", c."nombre", NULL::text AS producto, NULL::boolean AS tiene_variantes, c."nombre" AS categoria,
           SUM(l.unidades) AS unidades, SUM(l.facturado) AS facturacion, SUM(l.costo) AS costo
    FROM l
    JOIN "Variante" va ON va."id" = l."varianteId"
    JOIN "Producto" p ON p."id" = va."productoId"
    JOIN "Categoria" c ON c."id" = p."categoriaId"
    GROUP BY c."id", c."nombre"
    ORDER BY ${ordenSql(f.orden ?? "facturacion")}, c."nombre"
  `;
  return parsear(rankingSchema, crudo).map(aRanking);
}

/**
 * Ganancia real por producto y por sabor = Σ (precio efectivo − costo) ×
 * unidades, descontando lo devuelto (a su precio efectivo y su costo).
 */
export async function gananciaPorProducto(f: FiltroReporte) {
  const [productos, sabores] = await Promise.all([
    rankingProductos({ ...f, orden: "ganancia", limit: 1000 }),
    rankingVariantes({ ...f, orden: "ganancia", limit: 5000 }),
  ]);
  const total = productos.reduce(
    (a, p) => ({
      facturacion: a.facturacion.plus(p.facturacion),
      costo: a.costo.plus(p.costo),
      unidades: a.unidades + p.unidades,
    }),
    { facturacion: CERO, costo: CERO, unidades: 0 },
  );
  const ganancia = total.facturacion.minus(total.costo);
  return {
    productos,
    sabores,
    total: {
      unidades: total.unidades,
      facturacion: dec(total.facturacion),
      costo: dec(total.costo),
      ganancia: dec(ganancia),
      margen: porcentaje(ganancia, total.facturacion),
    },
  };
}

// =============================================================================
// Stock: sabores por producto, rotación, valorización, alertas
// =============================================================================

/** Unidades netas vendidas por variante (y depósito) en [inicio, fin). */
function vendidasPorVariante(inicio: Date, fin: Date, depositoId?: string) {
  return Prisma.sql`
    SELECT vi."varianteId", v."depositoId", SUM(vi."cantidad" - vi."cantidadDevuelta") AS unidades
    FROM "Venta" v JOIN "VentaItem" vi ON vi."ventaId" = v."id"
    WHERE v."estado" = 'CONFIRMADA' AND v."fecha" >= ${utc(inicio)} AND v."fecha" < ${utc(fin)}
      ${depositoId ? Prisma.sql`AND v."depositoId" = ${depositoId}` : Prisma.empty}
    GROUP BY vi."varianteId", v."depositoId"`;
}

/** Últimos 30 días completos (hoy incluido) en la zona del negocio. */
function ultimos30(tz: string) {
  const hoy = diaEn(ahora(), tz);
  return limitesRango(sumarDias(hoy, -29), hoy, tz);
}

const diasDeStock = (stock: number, promedio: number): number | null =>
  promedio > 0 ? Math.round((stock / promedio) * 10) / 10 : null;

/**
 * Sabor × (unidades vendidas en el período, stock por depósito, días de
 * stock = stock / promedio diario de los últimos 30 días).
 */
export async function saboresPorProducto(productoId: string, f: FiltroReporte) {
  const { tz, inicio, fin } = await contexto(f);
  const u30 = ultimos30(tz);
  const [depositos, crudo] = await Promise.all([
    prisma.deposito.findMany({
      where: { activo: true },
      orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
      select: { id: true, nombre: true },
    }),
    prisma.$queryRaw`
      WITH periodo AS (${vendidasPorVariante(inicio, fin, f.depositoId)}),
           ult AS (${vendidasPorVariante(u30.inicio, u30.fin, f.depositoId)})
      SELECT va."id", va."nombre", va."stockMinimo" AS minimo,
             COALESCE((SELECT SUM(unidades) FROM periodo WHERE periodo."varianteId" = va."id"), 0) AS vendidas,
             COALESCE((SELECT SUM(unidades) FROM ult WHERE ult."varianteId" = va."id"), 0) AS vendidas30,
             COALESCE((SELECT jsonb_object_agg(s."depositoId", s."cantidad") FROM "Stock" s WHERE s."varianteId" = va."id"), '{}') AS stock
      FROM "Variante" va
      WHERE va."productoId" = ${productoId} AND va."deletedAt" IS NULL
      ORDER BY vendidas DESC, va."nombre"
    `,
  ]);
  const filas = parsear(
    z.object({
      id: z.string(),
      nombre: z.string(),
      minimo: zInt,
      vendidas: zInt,
      vendidas30: zInt,
      stock: z.record(z.string(), z.number()),
    }),
    crudo,
  );
  return {
    depositos,
    sabores: filas.map((x) => {
      const porDeposito = Object.fromEntries(depositos.map((d) => [d.id, x.stock[d.id] ?? 0]));
      const stock = f.depositoId
        ? (porDeposito[f.depositoId] ?? 0)
        : Object.values(porDeposito).reduce((a, b) => a + b, 0);
      const promedio = x.vendidas30 / 30;
      return {
        varianteId: x.id,
        sabor: x.nombre,
        vendidas: x.vendidas,
        porDeposito,
        stock,
        minimo: x.minimo,
        promedioDiario: Math.round(promedio * 100) / 100,
        diasDeStock: diasDeStock(stock, promedio),
      };
    }),
  };
}

export type ClaseRotacion = "RAPIDA" | "NORMAL" | "LENTA" | "SIN_MOVIMIENTO";

export interface FilaRotacion {
  varianteId: string;
  productoId: string;
  producto: string;
  sabor: string;
  nombre: string;
  categoria: string;
  vendidas: number;
  stock: number;
  promedioDiario: number;
  /** stock / promedio diario del período (null: no se vendió). */
  diasDeStock: number | null;
  clase: ClaseRotacion;
  /** Stock a costo (solo si se pide con finanzas). */
  valorCosto?: string;
}

/**
 * Rotación por variante: unidades vendidas en el período, stock actual, días
 * de stock (stock / venta diaria promedio del período) y clase:
 *  - SIN_MOVIMIENTO: tiene stock y no se vendió nada en el período.
 *  - RAPIDA: días de stock ≤ rotacion.rapidaHastaDias (default 15).
 *  - LENTA:  días de stock > rotacion.lentaDesdeDias (default 60).
 *  - NORMAL: en el medio.
 * Variantes sin stock y sin ventas no se listan (no hay nada que mirar).
 */
export async function rotacionInventario(
  f: FiltroReporte & { conValor?: boolean },
): Promise<{ filas: FilaRotacion[]; resumen: Record<ClaseRotacion, number>; dias: number }> {
  const { inicio, fin } = await contexto(f);
  const { rotacion } = await obtenerConfigFinanzas();
  const dias = diasEntre(f.desde, f.hasta);
  const crudo = await prisma.$queryRaw`
    WITH vendidas AS (
      SELECT "varianteId", SUM(unidades) AS unidades
      FROM (${vendidasPorVariante(inicio, fin, f.depositoId)}) x GROUP BY "varianteId"
    ),
    stock AS (
      SELECT s."varianteId", SUM(s."cantidad") AS cantidad
      FROM "Stock" s JOIN "Deposito" d ON d."id" = s."depositoId" AND d."activo"
      ${f.depositoId ? Prisma.sql`WHERE s."depositoId" = ${f.depositoId}` : Prisma.empty}
      GROUP BY s."varianteId"
    )
    SELECT va."id", p."id" AS producto_id, p."nombre" AS producto, va."nombre" AS sabor,
           p."tieneVariantes" AS tiene_variantes, c."nombre" AS categoria,
           COALESCE(vd.unidades, 0) AS vendidas, COALESCE(st.cantidad, 0) AS stock,
           va."precioCosto" AS costo
    FROM "Variante" va
    JOIN "Producto" p ON p."id" = va."productoId"
    JOIN "Categoria" c ON c."id" = p."categoriaId"
    LEFT JOIN vendidas vd ON vd."varianteId" = va."id"
    LEFT JOIN stock st ON st."varianteId" = va."id"
    WHERE va."deletedAt" IS NULL AND p."deletedAt" IS NULL
      AND (COALESCE(vd.unidades, 0) > 0 OR COALESCE(st.cantidad, 0) > 0)
      ${f.categoriaId ? Prisma.sql`AND p."categoriaId" = ${f.categoriaId}` : Prisma.empty}
    ORDER BY p."nombre", va."nombre"
  `;
  const filas = parsear(
    z.object({
      id: z.string(),
      producto_id: z.string(),
      producto: z.string(),
      sabor: z.string(),
      tiene_variantes: z.boolean(),
      categoria: z.string(),
      vendidas: zInt,
      stock: zInt,
      costo: zDec,
    }),
    crudo,
  ).map((x): FilaRotacion => {
    const promedio = x.vendidas / dias;
    const diasStock = diasDeStock(x.stock, promedio);
    const clase: ClaseRotacion =
      x.vendidas <= 0
        ? "SIN_MOVIMIENTO"
        : (diasStock ?? 0) <= rotacion.rapidaHastaDias
          ? "RAPIDA"
          : (diasStock ?? 0) > rotacion.lentaDesdeDias
            ? "LENTA"
            : "NORMAL";
    return {
      varianteId: x.id,
      productoId: x.producto_id,
      producto: x.producto,
      sabor: x.sabor,
      nombre: nombreCompleto(x.producto, x.sabor, x.tiene_variantes),
      categoria: x.categoria,
      vendidas: x.vendidas,
      stock: x.stock,
      promedioDiario: Math.round(promedio * 100) / 100,
      diasDeStock: diasStock,
      clase,
      ...(f.conValor ? { valorCosto: dec(x.costo.mul(x.stock)) } : {}),
    };
  });
  const resumen: Record<ClaseRotacion, number> = {
    RAPIDA: 0,
    NORMAL: 0,
    LENTA: 0,
    SIN_MOVIMIENTO: 0,
  };
  for (const x of filas) resumen[x.clase]++;
  return { filas, resumen, dias };
}

/** Valor del stock a costo y a venta, por depósito y por categoría. */
export async function valorizacionInventario(f: { depositoId?: string } = {}) {
  const filtro = f.depositoId ? Prisma.sql`AND s."depositoId" = ${f.depositoId}` : Prisma.empty;
  const esquema = z.object({
    id: z.string(),
    nombre: z.string(),
    unidades: zInt,
    costo: zDec,
    venta: zDec,
  });
  const [porDeposito, porCategoria] = await Promise.all([
    prisma.$queryRaw`
      SELECT d."id", d."nombre", COALESCE(SUM(s."cantidad"), 0) AS unidades,
             COALESCE(SUM(s."cantidad" * va."precioCosto"), 0) AS costo,
             COALESCE(SUM(s."cantidad" * va."precioVenta"), 0) AS venta
      FROM "Deposito" d
      LEFT JOIN "Stock" s ON s."depositoId" = d."id"
      LEFT JOIN "Variante" va ON va."id" = s."varianteId" AND va."deletedAt" IS NULL
      WHERE d."activo" ${filtro}
      GROUP BY d."id", d."nombre", d."esPrincipal" ORDER BY d."esPrincipal" DESC, d."nombre"
    `,
    prisma.$queryRaw`
      SELECT c."id", c."nombre", SUM(s."cantidad") AS unidades,
             SUM(s."cantidad" * va."precioCosto") AS costo, SUM(s."cantidad" * va."precioVenta") AS venta
      FROM "Stock" s
      JOIN "Deposito" d ON d."id" = s."depositoId" AND d."activo"
      JOIN "Variante" va ON va."id" = s."varianteId" AND va."deletedAt" IS NULL
      JOIN "Producto" p ON p."id" = va."productoId"
      JOIN "Categoria" c ON c."id" = p."categoriaId"
      WHERE s."cantidad" > 0 ${filtro}
      GROUP BY c."id", c."nombre" ORDER BY costo DESC
    `,
  ]);
  const fmt = (r: z.output<typeof esquema>) => ({
    id: r.id,
    nombre: r.nombre,
    unidades: r.unidades,
    valorCosto: dec(r.costo),
    valorVenta: dec(r.venta),
    gananciaPotencial: dec(r.venta.minus(r.costo)),
    margen: porcentaje(r.venta.minus(r.costo), r.venta),
  });
  const deps = parsear(esquema, porDeposito);
  const total = deps.reduce(
    (a, r) => ({
      unidades: a.unidades + r.unidades,
      costo: a.costo.plus(r.costo),
      venta: a.venta.plus(r.venta),
    }),
    { unidades: 0, costo: CERO, venta: CERO },
  );
  return {
    porDeposito: deps.map(fmt),
    porCategoria: parsear(esquema, porCategoria).map(fmt),
    total: {
      unidades: total.unidades,
      valorCosto: dec(total.costo),
      valorVenta: dec(total.venta),
      gananciaPotencial: dec(total.venta.minus(total.costo)),
      margen: porcentaje(total.venta.minus(total.costo), total.venta),
    },
  };
}

export interface AlertaReposicion {
  varianteId: string;
  productoId: string;
  nombre: string;
  stockMinimo: number;
  stockTotal: number;
  estado: "SIN_STOCK" | "BAJO_MINIMO" | "OK";
  promedioDiario: number;
  /** max(0, ceil(promedio × días de cobertura − stock)). */
  sugerencia: number;
  porDeposito: {
    depositoId: string;
    deposito: string;
    stock: number;
    promedioDiario: number;
    sugerencia: number;
  }[];
}

/**
 * Bajo mínimo, sin stock y sugerencia de reposición = (venta diaria promedio
 * de los últimos 30 días × días de cobertura) − stock actual, por variante y
 * por depósito. Solo variantes activas con algo que avisar.
 */
export async function alertasStock(f: { depositoId?: string } = {}): Promise<{
  diasCobertura: number;
  alertas: AlertaReposicion[];
}> {
  const tz = await obtenerZonaHoraria();
  const { diasCobertura } = await obtenerConfigFinanzas();
  const u30 = ultimos30(tz);
  const crudo = await prisma.$queryRaw`
    WITH ult AS (${vendidasPorVariante(u30.inicio, u30.fin)}),
    base AS (
      SELECT va."id" AS variante_id, p."id" AS producto_id, p."nombre" AS producto, va."nombre" AS sabor,
             p."tieneVariantes" AS tiene_variantes, va."stockMinimo" AS minimo,
             d."id" AS deposito_id, d."nombre" AS deposito, d."esPrincipal" AS principal,
             COALESCE(s."cantidad", 0) AS stock,
             COALESCE(u.unidades, 0) AS vendidas30
      FROM "Variante" va
      JOIN "Producto" p ON p."id" = va."productoId"
      CROSS JOIN "Deposito" d
      LEFT JOIN "Stock" s ON s."varianteId" = va."id" AND s."depositoId" = d."id"
      LEFT JOIN ult u ON u."varianteId" = va."id" AND u."depositoId" = d."id"
      WHERE va."deletedAt" IS NULL AND va."activo" AND p."deletedAt" IS NULL AND p."activo" AND d."activo"
        ${f.depositoId ? Prisma.sql`AND d."id" = ${f.depositoId}` : Prisma.empty}
    )
    SELECT * FROM base ORDER BY producto, sabor, principal DESC, deposito
  `;
  const filas = parsear(
    z.object({
      variante_id: z.string(),
      producto_id: z.string(),
      producto: z.string(),
      sabor: z.string(),
      tiene_variantes: z.boolean(),
      minimo: zInt,
      deposito_id: z.string(),
      deposito: z.string(),
      stock: zInt,
      vendidas30: zInt,
    }),
    crudo,
  );
  const sugerir = (promedio: number, stock: number) =>
    Math.max(0, Math.ceil(promedio * diasCobertura - stock - 1e-9));
  const porVariante = new Map<string, AlertaReposicion>();
  for (const x of filas) {
    let a = porVariante.get(x.variante_id);
    if (!a) {
      a = {
        varianteId: x.variante_id,
        productoId: x.producto_id,
        nombre: nombreCompleto(x.producto, x.sabor, x.tiene_variantes),
        stockMinimo: x.minimo,
        stockTotal: 0,
        estado: "OK",
        promedioDiario: 0,
        sugerencia: 0,
        porDeposito: [],
      };
      porVariante.set(x.variante_id, a);
    }
    const promedio = x.vendidas30 / 30;
    a.stockTotal += x.stock;
    a.promedioDiario += promedio;
    a.porDeposito.push({
      depositoId: x.deposito_id,
      deposito: x.deposito,
      stock: x.stock,
      promedioDiario: Math.round(promedio * 100) / 100,
      sugerencia: sugerir(promedio, x.stock),
    });
  }
  const alertas = [...porVariante.values()]
    .map((a) => ({
      ...a,
      promedioDiario: Math.round(a.promedioDiario * 100) / 100,
      estado: (a.stockTotal <= 0
        ? "SIN_STOCK"
        : a.stockTotal < a.stockMinimo
          ? "BAJO_MINIMO"
          : "OK") as AlertaReposicion["estado"],
      sugerencia: sugerir(a.promedioDiario, a.stockTotal),
    }))
    .filter((a) => a.estado !== "OK" || a.sugerencia > 0)
    .sort(
      (a, b) =>
        ["SIN_STOCK", "BAJO_MINIMO", "OK"].indexOf(a.estado) -
          ["SIN_STOCK", "BAJO_MINIMO", "OK"].indexOf(b.estado) || b.sugerencia - a.sugerencia,
    );
  return { diasCobertura, alertas };
}

// =============================================================================
// Clientes, compras, costos, movimientos
// =============================================================================

/** Clientes con deuda, repartida por antigüedad de cada venta pendiente. */
export async function cuentasPorCobrar() {
  const tz = await obtenerZonaHoraria();
  const hoy = diaEn(ahora(), tz);
  const filas = parsear(
    z.object({
      id: z.string(),
      nombre: z.string(),
      apellido: z.string().nullable(),
      telefono: z.string().nullable(),
      saldo: zDec,
      d0_30: zDec,
      d31_60: zDec,
      d60: zDec,
      ventas: zInt,
      mas_vieja: zDate.nullable(),
    }),
    await prisma.$queryRaw`
      WITH p AS (
        SELECT v."clienteId", v."saldoPendiente" AS saldo, v."fecha",
               ${hoy}::date - (v."fecha" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date AS dias
        FROM "Venta" v
        WHERE v."estado" = 'CONFIRMADA' AND v."saldoPendiente" > 0 AND v."clienteId" IS NOT NULL
      )
      SELECT c."id", c."nombre", c."apellido", c."telefono", SUM(p.saldo) AS saldo,
             COALESCE(SUM(p.saldo) FILTER (WHERE p.dias <= 30), 0) AS d0_30,
             COALESCE(SUM(p.saldo) FILTER (WHERE p.dias BETWEEN 31 AND 60), 0) AS d31_60,
             COALESCE(SUM(p.saldo) FILTER (WHERE p.dias > 60), 0) AS d60,
             COUNT(*) AS ventas, MIN(p."fecha") AS mas_vieja
      FROM p JOIN "Cliente" c ON c."id" = p."clienteId"
      GROUP BY c."id", c."nombre", c."apellido", c."telefono"
      ORDER BY saldo DESC
    `,
  );
  const suma = (k: "saldo" | "d0_30" | "d31_60" | "d60") =>
    dec(filas.reduce((a, x) => a.plus(x[k]), CERO));
  return {
    clientes: filas.map((x) => ({
      clienteId: x.id,
      nombre: [x.nombre, x.apellido].filter(Boolean).join(" "),
      telefono: x.telefono,
      saldo: dec(x.saldo),
      d0_30: dec(x.d0_30),
      d31_60: dec(x.d31_60),
      d60: dec(x.d60),
      ventas: x.ventas,
      masVieja: x.mas_vieja,
    })),
    total: { saldo: suma("saldo"), d0_30: suma("d0_30"), d31_60: suma("d31_60"), d60: suma("d60") },
  };
}

export async function comprasPorProveedor(f: FiltroReporte) {
  const { inicio, fin } = await contexto(f);
  const filas = parsear(
    z.object({
      id: z.string().nullable(),
      nombre: z.string().nullable(),
      compras: zInt,
      unidades: zInt,
      total: zDec,
      ultima: zDate.nullable(),
    }),
    await prisma.$queryRaw`
      WITH co AS (
        SELECT c."proveedorId", c."total", c."fecha",
               (SELECT SUM(ci."cantidad") FROM "CompraItem" ci WHERE ci."compraId" = c."id") AS unidades
        FROM "Compra" c
        WHERE c."estado" = 'RECIBIDA' AND c."fecha" >= ${utc(inicio)} AND c."fecha" < ${utc(fin)}
          ${f.depositoId ? Prisma.sql`AND c."depositoId" = ${f.depositoId}` : Prisma.empty}
      )
      SELECT pr."id", pr."nombre", COUNT(*) AS compras, COALESCE(SUM(co.unidades), 0) AS unidades,
             SUM(co."total") AS total, MAX(co."fecha") AS ultima
      FROM co LEFT JOIN "Proveedor" pr ON pr."id" = co."proveedorId"
      GROUP BY pr."id", pr."nombre" ORDER BY total DESC
    `,
  );
  const total = filas.reduce((a, x) => a.plus(x.total), CERO);
  return {
    proveedores: filas.map((x) => ({
      proveedorId: x.id,
      proveedor: x.nombre ?? "Sin proveedor",
      compras: x.compras,
      unidades: x.unidades,
      total: dec(x.total),
      porcentaje: porcentaje(x.total, total),
      ultima: x.ultima,
    })),
    total: dec(total),
  };
}

/** Historial de costo y precio de una variante (HistorialPrecio). */
export async function evolucionCostos(varianteId: string) {
  const filas = await prisma.historialPrecio.findMany({
    where: { varianteId },
    orderBy: { createdAt: "asc" },
    include: { usuario: { select: { nombre: true } } },
  });
  return filas.map((h) => ({
    fecha: h.createdAt,
    costoAnterior: dec(h.precioCostoAnterior),
    costoNuevo: dec(h.precioCostoNuevo),
    ventaAnterior: dec(h.precioVentaAnterior),
    ventaNueva: dec(h.precioVentaNuevo),
    variacionCosto: porcentaje(
      h.precioCostoNuevo.minus(h.precioCostoAnterior),
      h.precioCostoAnterior,
    ),
    usuario: h.usuario.nombre,
    motivo: h.motivo,
  }));
}

/** Variantes cuyo costo cambió en el período: primer costo, último, variación %. */
export async function variacionCostos(f: FiltroReporte) {
  const { inicio, fin } = await contexto(f);
  const filas = parsear(
    z.object({
      id: z.string(),
      producto: z.string(),
      sabor: z.string(),
      tiene_variantes: z.boolean(),
      cambios: zInt,
      desde: zDec,
      hasta: zDec,
    }),
    await prisma.$queryRaw`
      SELECT va."id", p."nombre" AS producto, va."nombre" AS sabor, p."tieneVariantes" AS tiene_variantes,
             COUNT(*) AS cambios,
             (ARRAY_AGG(h."precioCostoAnterior" ORDER BY h."createdAt"))[1] AS desde,
             (ARRAY_AGG(h."precioCostoNuevo" ORDER BY h."createdAt" DESC))[1] AS hasta
      FROM "HistorialPrecio" h
      JOIN "Variante" va ON va."id" = h."varianteId"
      JOIN "Producto" p ON p."id" = va."productoId"
      WHERE h."createdAt" >= ${utc(inicio)} AND h."createdAt" < ${utc(fin)}
        AND h."precioCostoNuevo" <> h."precioCostoAnterior"
      GROUP BY va."id", p."nombre", va."nombre", p."tieneVariantes"
      ORDER BY p."nombre", va."nombre"
    `,
  );
  return filas.map((x) => ({
    varianteId: x.id,
    nombre: nombreCompleto(x.producto, x.sabor, x.tiene_variantes),
    cambios: x.cambios,
    costoInicial: dec(x.desde),
    costoFinal: dec(x.hasta),
    variacion: porcentaje(x.hasta.minus(x.desde), x.desde),
  }));
}

const ENTRADAS: ReadonlySet<TipoMovimiento> = new Set([
  TipoMovimiento.INGRESO_COMPRA,
  TipoMovimiento.INGRESO_MANUAL,
  TipoMovimiento.DEVOLUCION_CLIENTE,
  TipoMovimiento.AJUSTE_POSITIVO,
  TipoMovimiento.TRANSFERENCIA_ENTRADA,
]);

/**
 * Unidades que entraron y salieron por tipo de movimiento (y por usuario):
 * muchos AJUSTE_NEGATIVO = faltante o errores de carga.
 */
export async function movimientosPorTipo(f: FiltroReporte & { conValor?: boolean }) {
  const { inicio, fin } = await contexto(f);
  const filtro = Prisma.sql`m."createdAt" >= ${utc(inicio)} AND m."createdAt" < ${utc(fin)}
    ${f.depositoId ? Prisma.sql`AND m."depositoId" = ${f.depositoId}` : Prisma.empty}`;
  const [porTipo, porUsuario] = await Promise.all([
    prisma.$queryRaw`
      SELECT m."tipo"::text AS tipo, COUNT(*) AS movimientos, SUM(m."cantidad") AS unidades,
             SUM(m."cantidad" * COALESCE(m."costoUnitario", va."precioCosto")) AS valor
      FROM "MovimientoStock" m JOIN "Variante" va ON va."id" = m."varianteId"
      WHERE ${filtro}
      GROUP BY m."tipo" ORDER BY unidades DESC
    `,
    prisma.$queryRaw`
      SELECT u."nombre" AS usuario, m."tipo"::text AS tipo, COUNT(*) AS movimientos, SUM(m."cantidad") AS unidades,
             SUM(m."cantidad" * COALESCE(m."costoUnitario", va."precioCosto")) AS valor
      FROM "MovimientoStock" m
      JOIN "Usuario" u ON u."id" = m."usuarioId"
      JOIN "Variante" va ON va."id" = m."varianteId"
      WHERE ${filtro} AND m."tipo" IN ('AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'INGRESO_MANUAL')
      GROUP BY u."nombre", m."tipo" ORDER BY u."nombre", m."tipo"
    `,
  ]);
  const esquema = z.object({
    tipo: z.enum(TipoMovimiento),
    movimientos: zInt,
    unidades: zInt,
    valor: zDec,
  });
  const tipos = parsear(esquema, porTipo);
  return {
    porTipo: tipos.map((x) => ({
      tipo: x.tipo,
      sentido: ENTRADAS.has(x.tipo) ? ("entrada" as const) : ("salida" as const),
      movimientos: x.movimientos,
      unidades: x.unidades,
      ...(f.conValor ? { valor: dec(x.valor) } : {}),
    })),
    porUsuario: parsear(esquema.extend({ usuario: z.string() }), porUsuario).map((x) => ({
      usuario: x.usuario,
      tipo: x.tipo,
      movimientos: x.movimientos,
      unidades: x.unidades,
      ...(f.conValor ? { valor: dec(x.valor) } : {}),
    })),
    entradas: tipos.filter((x) => ENTRADAS.has(x.tipo)).reduce((a, x) => a + x.unidades, 0),
    salidas: tipos.filter((x) => !ENTRADAS.has(x.tipo)).reduce((a, x) => a + x.unidades, 0),
  };
}

/** Pendientes del dashboard: cosas que alguien tiene que resolver. */
export async function pendientes() {
  const [transferencias, compras, ventas] = await Promise.all([
    prisma.transferencia.count({ where: { estado: "PENDIENTE" } }),
    prisma.compra.count({ where: { estado: "BORRADOR" } }),
    prisma.venta.count({ where: { estado: "BORRADOR" } }),
  ]);
  return { transferencias, compras, ventas };
}

/**
 * Venta diaria promedio de los últimos 30 días por variante (unidades netas).
 * Con depósito: solo lo vendido desde ese depósito.
 */
export async function promediosVenta30(depositoId?: string): Promise<Map<string, number>> {
  const tz = await obtenerZonaHoraria();
  const u30 = ultimos30(tz);
  const filas = parsear(
    z.object({ varianteId: z.string(), unidades: zInt }),
    await prisma.$queryRaw`
      SELECT "varianteId", SUM(unidades) AS unidades
      FROM (${vendidasPorVariante(u30.inicio, u30.fin, depositoId)}) x GROUP BY "varianteId"
    `,
  );
  return new Map(filas.map((f) => [f.varianteId, f.unidades / 30]));
}

export { diasDeStock };
