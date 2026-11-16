import "server-only";

import {
  EstadoCompra,
  Prisma,
  type EstadoVenta,
  MedioPago,
  type TipoMovimiento,
  type TipoVenta,
} from "@prisma/client";
import { z } from "zod";

import { pesosAMoneda, vistaCostosUsdt } from "@/lib/costos-compra";
import { sumarMontos, type Montos } from "@/lib/moneda";
import { estadoDeStock, type EstadoStockUI } from "@/lib/movimientos-ui";
import { ahora } from "@/lib/reloj";
import { ZONA_DEFAULT } from "@/lib/zona-horaria";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";
import type {
  FiltrosComprasReporte,
  FiltrosDevolucionesReporte,
  FiltrosMovimientosReporte,
  FiltrosStockReporte,
  FiltrosVentasReporte,
  RangoReporte,
} from "@/server/reportes/filtros";
import { SQL_USD_GANANCIA, SQL_USD_TOTAL } from "@/server/moneda/montos-venta";
import { obtenerCotizaciones } from "@/server/services/cambio.service";

/**
 * REPORTES del panel (4 a 9). Todo se agrega en PostgreSQL ($queryRaw con
 * `"panelId" = ctx.panelId` explícito, resultados validados con Zod); Node
 * solo presenta. Costos, ganancias y totales comprados: el que llama decide
 * (`owner`) y acá se devuelven `null` si no corresponde.
 *
 * MONEDA (ver src/lib/moneda.ts): los montos salen como `Montos` (USDT
 * principal, pesos y dólares). Sumar en USDT es sumar lo de cada venta a SU
 * cotización (columnas Venta.totalUsdt / gananciaUsdt); nunca se divide una
 * suma en pesos por la cotización de hoy.
 */

const num = z.union([z.number(), z.bigint(), z.string(), z.instanceof(Prisma.Decimal)]);
const monto = num.transform((v) => new Prisma.Decimal(v.toString()).toFixed(2));
const entero = num.transform((v) => Number(v));
const M = (usdt: string, pesos: string, usd: string): Montos => ({ usdt, pesos, usd });

/**
 * Por ítem de venta (alias `vi` / `v`): el subtotal del ítem neto del
 * descuento de la venta (prorrateado), en pesos. Sin esto la ganancia por
 * producto ignora el descuento y queda inflada.
 */
const SQL_NETO_ITEM = Prisma.sql`COALESCE(vi."subtotal" * v."total" / NULLIF(v."subtotal", 0), 0)`;
const TZ = ZONA_DEFAULT;

/**
 * Instante → timestamp UTC "naive" (así están las columnas de Prisma). Sin
 * esto, Postgres compara el parámetro timestamptz convirtiendo la columna con
 * la zona de la SESIÓN (en la DB local, Buenos Aires): 3 horas corridas.
 */
export const ts = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

/** Límite de filas de una exportación (la pantalla pagina). */
export const MAX_FILAS_EXPORTACION = 10_000;
const POR_PAGINA = 50;

// =============================================================================
// 4. Ventas (detalle con filtros)
// =============================================================================

export interface VentaReporte {
  id: string;
  codigo: string;
  fecha: Date;
  cliente: string;
  vendedor: string;
  deposito: string;
  tipo: TipoVenta;
  /** Medio principal; null si se fió todo. */
  medioPago: MedioPago | null;
  estado: EstadoVenta;
  unidades: number;
  /** A la cotización de la venta. */
  total: Montos;
  ganancia: Montos | null;
}

export interface ReporteVentas {
  filas: VentaReporte[];
  cantidad: number;
  page: number;
  pageSize: number;
  resumen: { ventas: number; unidades: number; total: Montos; ganancia: Montos | null };
  porDia: { dia: string; ventas: number; total: Montos }[];
}

function whereVentas(ctx: Ctx, r: RangoReporte, f: FiltrosVentasReporte): Prisma.Sql {
  const estado = f.estado ?? "CONFIRMADA";
  return Prisma.sql`v."panelId" = ${ctx.panelId} AND v."fecha" >= ${ts(r.inicio)} AND v."fecha" < ${ts(r.fin)}
    ${estado === "TODAS" ? Prisma.empty : Prisma.sql`AND v."estado" = ${estado}::"EstadoVenta"`}
    ${f.vendedorId ? Prisma.sql`AND v."vendedorId" = ${f.vendedorId}` : Prisma.empty}
    ${f.depositoId ? Prisma.sql`AND v."depositoId" = ${f.depositoId}` : Prisma.empty}
    ${
      f.medioPago
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM "PagoVenta" pv WHERE pv."ventaId" = v."id"
            AND pv."panelId" = ${ctx.panelId} AND pv."medioPago" = ${f.medioPago}::"MedioPago")`
        : Prisma.empty
    }
    ${f.tipo ? Prisma.sql`AND v."tipo" = ${f.tipo}::"TipoVenta"` : Prisma.empty}`;
}

const filaVentaSchema = z.array(
  z.object({
    id: z.string(),
    codigo: z.string(),
    fecha: z.date(),
    cliente: z.string(),
    vendedor: z.string(),
    deposito: z.string(),
    tipo: z.enum(["UNITARIA", "MAYORISTA"]),
    medio_pago: z.enum(MedioPago).nullable(),
    estado: z.enum(["CONFIRMADA", "ANULADA"]),
    unidades: entero,
    total_usdt: monto,
    total_pesos: monto,
    total_usd: monto,
    ganancia_usdt: monto,
    ganancia_pesos: monto,
    ganancia_usd: monto,
  }),
);
const resumenVentasSchema = z.array(
  z.object({
    ventas: entero,
    unidades: entero,
    total_usdt: monto,
    total_pesos: monto,
    total_usd: monto,
    ganancia_usdt: monto,
    ganancia_pesos: monto,
    ganancia_usd: monto,
  }),
);
const porDiaSchema = z.array(
  z.object({
    dia: z.string(),
    ventas: entero,
    total_usdt: monto,
    total_pesos: monto,
    total_usd: monto,
  }),
);

/** SELECT de total y ganancia de UNA venta en las tres monedas (alias `v`). */
const SQL_MONTOS_VENTA = Prisma.sql`v."totalUsdt" AS total_usdt, v."total" AS total_pesos,
  ${SQL_USD_TOTAL} AS total_usd, v."gananciaUsdt" AS ganancia_usdt,
  v."gananciaBruta" AS ganancia_pesos, ${SQL_USD_GANANCIA} AS ganancia_usd`;
/** Lo mismo sumado (cada venta a su cotización). */
const SQL_SUMA_TOTAL = Prisma.sql`COALESCE(SUM(v."totalUsdt"), 0) AS total_usdt,
  COALESCE(SUM(v."total"), 0) AS total_pesos, COALESCE(SUM(${SQL_USD_TOTAL}), 0) AS total_usd`;
const SQL_SUMA_GANANCIA = Prisma.sql`COALESCE(SUM(v."gananciaUsdt"), 0) AS ganancia_usdt,
  COALESCE(SUM(v."gananciaBruta"), 0) AS ganancia_pesos,
  COALESCE(SUM(${SQL_USD_GANANCIA}), 0) AS ganancia_usd`;

export async function reporteVentas(
  ctx: Ctx,
  r: RangoReporte,
  f: FiltrosVentasReporte,
  opciones: { owner: boolean; exportar?: boolean },
): Promise<ReporteVentas> {
  const db = dbPara(ctx.panelId);
  const where = whereVentas(ctx, r, f);
  // Totales y serie: con «Todas», solo suman las confirmadas (una anulada no es plata vendida).
  const whereSumas =
    (f.estado ?? "CONFIRMADA") === "TODAS"
      ? Prisma.sql`${where} AND v."estado" = 'CONFIRMADA'`
      : where;
  const pageSize = opciones.exportar ? MAX_FILAS_EXPORTACION : POR_PAGINA;
  const offset = opciones.exportar ? 0 : (f.page - 1) * POR_PAGINA;
  const [filas, resumen, porDia] = await Promise.all([
    db.$queryRaw`
      SELECT v."id", v."codigo", v."fecha", c."nombre" AS cliente, u."nombre" AS vendedor,
             d."nombre" AS deposito, v."tipo"::text AS tipo, v."medioPago"::text AS medio_pago,
             v."estado"::text AS estado,
             COALESCE((SELECT SUM(vi."cantidad") FROM "VentaItem" vi WHERE vi."ventaId" = v."id"), 0) AS unidades,
             ${SQL_MONTOS_VENTA}
      FROM "Venta" v
      JOIN "Cliente" c ON c."id" = v."clienteId"
      JOIN "Usuario" u ON u."id" = v."vendedorId"
      JOIN "Deposito" d ON d."id" = v."depositoId"
      WHERE ${where}
      ORDER BY v."fecha" DESC, v."numero" DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    db.$queryRaw`
      SELECT COUNT(*) AS ventas,
             COALESCE(SUM((SELECT SUM(vi."cantidad") FROM "VentaItem" vi WHERE vi."ventaId" = v."id")), 0) AS unidades,
             ${SQL_SUMA_TOTAL}, ${SQL_SUMA_GANANCIA}
      FROM "Venta" v WHERE ${whereSumas}`,
    db.$queryRaw`
      SELECT to_char(v."fecha" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS dia,
             COUNT(*) AS ventas, ${SQL_SUMA_TOTAL}
      FROM "Venta" v WHERE ${whereSumas}
      GROUP BY 1 ORDER BY 1`,
  ]);
  const res = resumenVentasSchema.parse(resumen)[0]!;
  return {
    filas: filaVentaSchema.parse(filas).map((v) => ({
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      cliente: v.cliente,
      vendedor: v.vendedor,
      deposito: v.deposito,
      tipo: v.tipo,
      medioPago: v.medio_pago,
      estado: v.estado,
      unidades: v.unidades,
      total: M(v.total_usdt, v.total_pesos, v.total_usd),
      ganancia: opciones.owner ? M(v.ganancia_usdt, v.ganancia_pesos, v.ganancia_usd) : null,
    })),
    cantidad: res.ventas,
    page: f.page,
    pageSize,
    resumen: {
      ventas: res.ventas,
      unidades: res.unidades,
      total: M(res.total_usdt, res.total_pesos, res.total_usd),
      ganancia: opciones.owner ? M(res.ganancia_usdt, res.ganancia_pesos, res.ganancia_usd) : null,
    },
    porDia: porDiaSchema.parse(porDia).map((d) => ({
      dia: d.dia,
      ventas: d.ventas,
      total: M(d.total_usdt, d.total_pesos, d.total_usd),
    })),
  };
}

// =============================================================================
// 5. Stock por galpón y sabor (matriz producto × sabor × depósito)
// =============================================================================

export interface FilaStockReporte {
  varianteId: string;
  producto: string;
  sabor: string;
  porDeposito: Record<string, number>;
  total: number;
  minimo: number;
  estado: EstadoStockUI;
}

export interface ReporteStock {
  depositos: { id: string; nombre: string }[];
  filas: FilaStockReporte[];
  totales: { porDeposito: Record<string, number>; total: number; bajo: number; sinStock: number };
}

const filaStockSchema = z.array(
  z.object({
    variante_id: z.string(),
    producto: z.string(),
    variante: z.string(),
    stock_minimo: entero,
    por_deposito: z.record(z.string(), z.number()),
  }),
);

export async function reporteStock(ctx: Ctx, f: FiltrosStockReporte): Promise<ReporteStock> {
  const db = dbPara(ctx.panelId);
  const palabras = (f.q ?? "").split(/\s+/).filter(Boolean).slice(0, 5);
  const [depositosTodos, crudas] = await Promise.all([
    db.deposito.findMany({
      where: { activo: true },
      orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
      select: { id: true, nombre: true },
    }),
    db.$queryRaw`
      SELECT s.variante_id, s.producto, s.variante, s.stock_minimo, s.por_deposito
      FROM vw_stock_consolidado s
      JOIN "Variante" v ON v."id" = s.variante_id AND v."activo"
      JOIN "Producto" p ON p."id" = s.producto_id AND p."activo"
      WHERE s.panel_id = ${ctx.panelId}
        ${
          palabras.length
            ? Prisma.sql`AND ${Prisma.join(
                palabras.map(
                  (w) => Prisma.sql`(s.producto ILIKE ${`%${w}%`} OR s.variante ILIKE ${`%${w}%`})`,
                ),
                " AND ",
              )}`
            : Prisma.empty
        }
      ORDER BY s.producto, s.variante
      LIMIT ${MAX_FILAS_EXPORTACION}`,
  ]);
  const depositos = f.depositoId
    ? depositosTodos.filter((d) => d.id === f.depositoId)
    : depositosTodos;
  const filas = filaStockSchema
    .parse(crudas)
    .map((s) => {
      const porDeposito = Object.fromEntries(
        depositos.map((d) => [d.id, s.por_deposito[d.id] ?? 0]),
      );
      const total = Object.values(porDeposito).reduce((a, n) => a + n, 0);
      return {
        varianteId: s.variante_id,
        producto: s.producto,
        sabor: s.variante,
        porDeposito,
        total,
        minimo: s.stock_minimo,
        estado: estadoDeStock(total, s.stock_minimo),
      };
    })
    .filter((s) => !f.estado || s.estado === f.estado);
  return {
    depositos,
    filas,
    totales: {
      porDeposito: Object.fromEntries(
        depositos.map((d) => [d.id, filas.reduce((a, s) => a + (s.porDeposito[d.id] ?? 0), 0)]),
      ),
      total: filas.reduce((a, s) => a + s.total, 0),
      bajo: filas.filter((s) => s.estado === "BAJO").length,
      sinStock: filas.filter((s) => s.estado === "SIN_STOCK").length,
    },
  };
}

// =============================================================================
// 6. Movimientos de stock por tipo, galpón y usuario
// =============================================================================

export interface ReporteMovimientos {
  porTipo: { tipo: TipoMovimiento; movimientos: number; unidades: number }[];
  filas: {
    tipo: TipoMovimiento;
    deposito: string;
    usuario: string;
    movimientos: number;
    unidades: number;
  }[];
  total: { movimientos: number; unidades: number };
}

const filaMovSchema = z.array(
  z.object({
    tipo: z.string(),
    deposito: z.string(),
    usuario: z.string(),
    movimientos: entero,
    unidades: entero,
  }),
);

export async function reporteMovimientos(
  ctx: Ctx,
  r: RangoReporte,
  f: FiltrosMovimientosReporte,
): Promise<ReporteMovimientos> {
  const crudas = await dbPara(ctx.panelId).$queryRaw`
    SELECT m."tipo"::text AS tipo, d."nombre" AS deposito, u."nombre" AS usuario,
           COUNT(*) AS movimientos, COALESCE(SUM(m."cantidad"), 0) AS unidades
    FROM "MovimientoStock" m
    JOIN "Deposito" d ON d."id" = m."depositoId"
    JOIN "Usuario" u ON u."id" = m."usuarioId"
    WHERE m."panelId" = ${ctx.panelId} AND m."createdAt" >= ${ts(r.inicio)} AND m."createdAt" < ${ts(r.fin)}
      ${f.tipo ? Prisma.sql`AND m."tipo" = ${f.tipo}::"TipoMovimiento"` : Prisma.empty}
      ${f.depositoId ? Prisma.sql`AND m."depositoId" = ${f.depositoId}` : Prisma.empty}
      ${f.usuarioId ? Prisma.sql`AND m."usuarioId" = ${f.usuarioId}` : Prisma.empty}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3`;
  const filas = filaMovSchema.parse(crudas).map((x) => ({ ...x, tipo: x.tipo as TipoMovimiento }));
  const porTipo = new Map<TipoMovimiento, { movimientos: number; unidades: number }>();
  for (const x of filas) {
    const a = porTipo.get(x.tipo) ?? { movimientos: 0, unidades: 0 };
    porTipo.set(x.tipo, {
      movimientos: a.movimientos + x.movimientos,
      unidades: a.unidades + x.unidades,
    });
  }
  return {
    filas,
    porTipo: [...porTipo.entries()]
      .map(([tipo, v]) => ({ tipo, ...v }))
      .sort((a, b) => b.unidades - a.unidades),
    total: {
      movimientos: filas.reduce((a, x) => a + x.movimientos, 0),
      unidades: filas.reduce((a, x) => a + x.unidades, 0),
    },
  };
}

/** Usuarios que movieron stock en el panel (filtro). */
export async function usuariosConMovimientos(ctx: Ctx): Promise<{ id: string; nombre: string }[]> {
  const filas = z.array(z.object({ id: z.string(), nombre: z.string() })).parse(
    await dbPara(ctx.panelId).$queryRaw`
        SELECT u."id", u."nombre" FROM "Usuario" u
        WHERE EXISTS (SELECT 1 FROM "MovimientoStock" m WHERE m."panelId" = ${ctx.panelId} AND m."usuarioId" = u."id")
        ORDER BY u."nombre"`,
  );
  return filas;
}

// =============================================================================
// 7. Compras por proveedor (SOLO dueños)
// =============================================================================

export interface CompraPorProveedor {
  proveedorId: string | null;
  proveedor: string;
  tienda: string | null;
  compras: number;
  unidades: number;
  /**
   * Montos de las compras recibidas. USDT: lo de cada compra en USDT
   * (`vistaCostosUsdt`: las cargadas en USDT, tal cual; las anteriores en
   * pesos, pasadas con su cotización → aproximado). Pesos: las columnas de la
   * compra. Dólares: pesos ÷ dólar blue de cada compra.
   */
  total: Montos;
  /** Comisión del pasista + gastos extras + costo final (total + ambos). */
  comision: Montos;
  gastos: Montos;
  costoFinalTotal: Montos;
  /** costoFinalTotal ÷ unidades (a centavos, en cada moneda); null sin unidades. */
  costoFinalUnidad: Montos | null;
  /**
   * true = alguna compra se pasó a USDT/dólares de forma aproximada: cargada
   * en pesos (anterior a las compras en USDT) o sin cotización guardada (se
   * usó la vigente).
   */
  aproximado: boolean;
  /** Compras sin ninguna cotización (ni guardada ni vigente): suman 0 en USDT y dólares. */
  sinCotizacion: number;
  ultima: Date | null;
}

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

export async function comprasPorProveedor(
  ctx: Ctx,
  r: RangoReporte,
  f: FiltrosComprasReporte,
): Promise<CompraPorProveedor[]> {
  const [cot, compras] = await Promise.all([
    obtenerCotizaciones(),
    dbPara(ctx.panelId).compra.findMany({
      where: {
        estado: EstadoCompra.RECIBIDA,
        fecha: { gte: r.inicio, lt: r.fin },
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
      },
      select: {
        proveedorId: true,
        proveedor: { select: { nombre: true, nombreTienda: true } },
        fecha: true,
        total: true,
        descuento: true,
        comisionPasistaPorcentaje: true,
        comisionPasistaMonto: true,
        gastosExtrasTotal: true,
        costoFinalTotal: true,
        tipoCambioUSDT: true,
        tipoCambioUSD: true,
        costosEnUsdt: true,
        items: {
          select: {
            cantidad: true,
            costoUnitario: true,
            costoUnitarioUSDT: true,
            costoUnitarioFinal: true,
          },
          orderBy: { createdAt: "asc" },
        },
        gastos: { where: { anulado: false }, select: { monto: true, montoUSDT: true } },
      },
    }),
  ]);
  const usdtVigente = cot.USDT?.valor ?? null;
  const blueVigente = cot.USD_BLUE?.valor ?? null;

  interface Acum {
    proveedorId: string | null;
    proveedor: string;
    tienda: string | null;
    compras: number;
    unidades: number;
    total: Montos[];
    comision: Montos[];
    gastos: Montos[];
    costoFinal: Montos[];
    aproximado: boolean;
    sinCotizacion: number;
    ultima: Date | null;
  }
  const grupos = new Map<string, Acum>();
  for (const c of compras) {
    const clave = c.proveedorId ?? "";
    const g: Acum = grupos.get(clave) ?? {
      proveedorId: c.proveedorId,
      proveedor: c.proveedor?.nombre ?? "Sin proveedor",
      tienda: c.proveedor?.nombreTienda ?? null,
      compras: 0,
      unidades: 0,
      total: [],
      comision: [],
      gastos: [],
      costoFinal: [],
      aproximado: false,
      sinCotizacion: 0,
      ultima: null,
    };
    grupos.set(clave, g);
    g.compras += 1;
    g.unidades += c.items.reduce((a, i) => a + i.cantidad, 0);
    if (!g.ultima || c.fecha > g.ultima) g.ultima = c.fecha;

    const tcUsdt = c.tipoCambioUSDT?.toFixed(2) ?? (usdtVigente ? usdtVigente.toFixed(2) : null);
    const tcUsd = c.tipoCambioUSD?.toFixed(2) ?? (blueVigente ? blueVigente.toFixed(2) : null);
    if (!c.tipoCambioUSDT || !c.tipoCambioUSD) g.aproximado = true;
    if (!tcUsdt || !tcUsd) g.sinCotizacion += 1;
    const vista = tcUsdt
      ? vistaCostosUsdt({
          costosEnUsdt: c.costosEnUsdt,
          tipoCambioUSDT: tcUsdt,
          comisionPorcentaje: c.comisionPasistaPorcentaje?.toFixed(2) ?? null,
          descuento: c.descuento.toFixed(2),
          items: c.items.map((i) => ({
            cantidad: i.cantidad,
            costoUnitario: i.costoUnitario.toFixed(2),
            costoUnitarioUSDT: i.costoUnitarioUSDT?.toFixed(2) ?? null,
            costoUnitarioFinal: i.costoUnitarioFinal.toFixed(2),
          })),
          gastos: c.gastos.map((x) => ({
            monto: x.monto.toFixed(2),
            montoUSDT: x.montoUSDT?.toFixed(2) ?? null,
          })),
        })
      : null;
    if (vista?.aproximado) g.aproximado = true;
    const m = (usdt: number | undefined, pesos: Prisma.Decimal): Montos => ({
      usdt: (usdt ?? 0).toFixed(2),
      pesos: pesos.toFixed(2),
      usd: (tcUsd ? pesosAMoneda(pesos.toFixed(2), tcUsd) : 0).toFixed(2),
    });
    g.total.push(m(vista?.costos.total, c.total));
    g.comision.push(m(vista?.costos.comision, c.comisionPasistaMonto));
    g.gastos.push(m(vista?.costos.gastos, c.gastosExtrasTotal));
    g.costoFinal.push(m(vista?.costos.costoFinalTotal, c.costoFinalTotal));
  }

  const porUnidad = (t: Montos, unidades: number): Montos => {
    const div = (x: string) => D(x).div(unidades).toDecimalPlaces(2).toFixed(2);
    return { usdt: div(t.usdt), pesos: div(t.pesos), usd: div(t.usd) };
  };
  return [...grupos.values()]
    .map((g) => {
      const costoFinalTotal = sumarMontos(g.costoFinal);
      return {
        proveedorId: g.proveedorId,
        proveedor: g.proveedor,
        tienda: g.tienda,
        compras: g.compras,
        unidades: g.unidades,
        total: sumarMontos(g.total),
        comision: sumarMontos(g.comision),
        gastos: sumarMontos(g.gastos),
        costoFinalTotal,
        costoFinalUnidad: g.unidades > 0 ? porUnidad(costoFinalTotal, g.unidades) : null,
        aproximado: g.aproximado,
        sinCotizacion: g.sinCotizacion,
        ultima: g.ultima,
      };
    })
    .sort(
      (a, b) =>
        Number(b.total.usdt) - Number(a.total.usdt) ||
        Number(b.total.pesos) - Number(a.total.pesos),
    );
}

// =============================================================================
// 8. Clientes: nuevos, top compradores (dueños), inactivos > 60 días
// =============================================================================

export const DIAS_INACTIVO = 60;

export interface ReporteClientes {
  nuevos: { id: string; nombre: string; telefono: string; alta: Date; compras: number }[];
  nuevosPorDia: { dia: string; clientes: number }[];
  /** null = quien mira no es dueño. */
  top:
    | {
        id: string;
        nombre: string;
        telefono: string;
        compras: number;
        unidades: number;
        /** Cada venta a su cotización. */
        total: Montos;
      }[]
    | null;
  inactivos: {
    id: string;
    nombre: string;
    telefono: string;
    ultimaCompra: Date;
    dias: number;
    compras: number;
  }[];
}

export async function reporteClientes(
  ctx: Ctx,
  r: RangoReporte,
  opciones: { owner: boolean },
): Promise<ReporteClientes> {
  const db = dbPara(ctx.panelId);
  const corte = new Date(ahora().getTime() - DIAS_INACTIVO * 86_400_000);
  const [nuevos, porDia, top, inactivos] = await Promise.all([
    db.$queryRaw`
      SELECT c."id", c."nombre", c."telefono", c."createdAt" AS alta,
             (SELECT COUNT(*) FROM "Venta" v WHERE v."panelId" = ${ctx.panelId} AND v."clienteId" = c."id" AND v."estado" = 'CONFIRMADA') AS compras
      FROM "Cliente" c
      WHERE c."panelId" = ${ctx.panelId} AND c."deletedAt" IS NULL
        AND c."createdAt" >= ${ts(r.inicio)} AND c."createdAt" < ${ts(r.fin)}
      ORDER BY c."createdAt" DESC
      LIMIT 1000`,
    db.$queryRaw`
      SELECT to_char(c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS dia, COUNT(*) AS clientes
      FROM "Cliente" c
      WHERE c."panelId" = ${ctx.panelId} AND c."deletedAt" IS NULL
        AND c."createdAt" >= ${ts(r.inicio)} AND c."createdAt" < ${ts(r.fin)}
      GROUP BY 1 ORDER BY 1`,
    opciones.owner
      ? db.$queryRaw`
          SELECT c."id", c."nombre", c."telefono", COUNT(*) AS compras,
                 COALESCE(SUM((SELECT SUM(vi."cantidad") FROM "VentaItem" vi WHERE vi."ventaId" = v."id")), 0) AS unidades,
                 ${SQL_SUMA_TOTAL}
          FROM "Venta" v JOIN "Cliente" c ON c."id" = v."clienteId"
          WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
            AND v."fecha" >= ${ts(r.inicio)} AND v."fecha" < ${ts(r.fin)}
          GROUP BY c."id", c."nombre", c."telefono"
          ORDER BY total_usdt DESC, total_pesos DESC
          LIMIT 20`
      : Promise.resolve(null),
    db.$queryRaw`
      SELECT c."id", c."nombre", c."telefono", MAX(v."fecha") AS ultima_compra, COUNT(*) AS compras
      FROM "Venta" v JOIN "Cliente" c ON c."id" = v."clienteId" AND c."deletedAt" IS NULL AND c."activo"
      WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
      GROUP BY c."id", c."nombre", c."telefono"
      HAVING MAX(v."fecha") < ${ts(corte)}
      ORDER BY ultima_compra DESC
      LIMIT 1000`,
  ]);
  const momento = ahora().getTime();
  return {
    nuevos: z
      .array(
        z.object({
          id: z.string(),
          nombre: z.string(),
          telefono: z.string(),
          alta: z.date(),
          compras: entero,
        }),
      )
      .parse(nuevos),
    nuevosPorDia: z.array(z.object({ dia: z.string(), clientes: entero })).parse(porDia),
    top:
      top === null
        ? null
        : z
            .array(
              z.object({
                id: z.string(),
                nombre: z.string(),
                telefono: z.string(),
                compras: entero,
                unidades: entero,
                total_usdt: monto,
                total_pesos: monto,
                total_usd: monto,
              }),
            )
            .parse(top)
            .map((x) => ({
              id: x.id,
              nombre: x.nombre,
              telefono: x.telefono,
              compras: x.compras,
              unidades: x.unidades,
              total: M(x.total_usdt, x.total_pesos, x.total_usd),
            })),
    inactivos: z
      .array(
        z.object({
          id: z.string(),
          nombre: z.string(),
          telefono: z.string(),
          ultima_compra: z.date(),
          compras: entero,
        }),
      )
      .parse(inactivos)
      .map((c) => ({
        id: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        ultimaCompra: c.ultima_compra,
        dias: Math.floor((momento - c.ultima_compra.getTime()) / 86_400_000),
        compras: c.compras,
      })),
  };
}

// =============================================================================
// 9. Devoluciones por garantía por producto/sabor
// =============================================================================

export interface ReporteDevoluciones {
  filas: {
    productoId: string;
    producto: string;
    sabor: string;
    devoluciones: number;
    unidades: number;
  }[];
  porProducto: { producto: string; unidades: number }[];
  total: { devoluciones: number; unidades: number };
}

export async function reporteDevoluciones(
  ctx: Ctx,
  r: RangoReporte,
  f: FiltrosDevolucionesReporte,
): Promise<ReporteDevoluciones> {
  const db = dbPara(ctx.panelId);
  const where = Prisma.sql`d."panelId" = ${ctx.panelId} AND d."estado" = 'REGISTRADA'
    AND d."fecha" >= ${ts(r.inicio)} AND d."fecha" < ${ts(r.fin)}
    ${f.depositoId ? Prisma.sql`AND d."depositoId" = ${f.depositoId}` : Prisma.empty}`;
  const [crudas, total] = await Promise.all([
    db.$queryRaw`
      SELECT p."id" AS producto_id, p."nombreCompleto" AS producto, va."nombre" AS sabor,
             COUNT(DISTINCT d."id") AS devoluciones, SUM(di."cantidad") AS unidades
      FROM "DevolucionItem" di
      JOIN "Devolucion" d ON d."id" = di."devolucionId"
      JOIN "Variante" va ON va."id" = di."varianteId"
      JOIN "Producto" p ON p."id" = di."productoId"
      WHERE ${where}
      GROUP BY 1, 2, 3
      ORDER BY unidades DESC, producto, sabor`,
    db.$queryRaw`
      SELECT COUNT(DISTINCT d."id") AS devoluciones, COALESCE(SUM(di."cantidad"), 0) AS unidades
      FROM "Devolucion" d JOIN "DevolucionItem" di ON di."devolucionId" = d."id"
      WHERE ${where}`,
  ]);
  const filas = z
    .array(
      z.object({
        producto_id: z.string(),
        producto: z.string(),
        sabor: z.string(),
        devoluciones: entero,
        unidades: entero,
      }),
    )
    .parse(crudas)
    .map((x) => ({
      productoId: x.producto_id,
      producto: x.producto,
      sabor: x.sabor,
      devoluciones: x.devoluciones,
      unidades: x.unidades,
    }));
  const porProducto = new Map<string, number>();
  for (const x of filas)
    porProducto.set(x.producto, (porProducto.get(x.producto) ?? 0) + x.unidades);
  return {
    filas,
    porProducto: [...porProducto.entries()]
      .map(([producto, unidades]) => ({ producto, unidades }))
      .sort((a, b) => b.unidades - a.unidades),
    total: z.array(z.object({ devoluciones: entero, unidades: entero })).parse(total)[0]!,
  };
}

// =============================================================================
// Ventas Mercado Libre (paneles que cobran por ML)
// =============================================================================

export interface ReporteMercadoLibre {
  /** Ventas confirmadas cuyo medio principal es Mercado Libre. */
  total: {
    ventas: number;
    unidades: number;
    /** Cada venta a su cotización. */
    facturado: Montos;
    /** null si quien mira no es dueño. */
    ganancia: Montos | null;
    /** Unidades cobradas a precio Mercado Libre (el resto, a lista o precio especial). */
    unidadesPrecioML: number;
  };
  porDia: { dia: string; ventas: number; facturado: Montos }[];
  filas: {
    productoId: string;
    producto: string;
    sabor: string;
    unidades: number;
    /** Neto del descuento de la venta (prorrateado), a la cotización de cada venta. */
    facturado: Montos;
    /** Ganancia de esos ítems (neta del descuento prorrateado); null si no es dueño. */
    ganancia: Montos | null;
  }[];
}

export async function reporteMercadoLibre(
  ctx: Ctx,
  r: RangoReporte,
  opciones: { owner: boolean },
): Promise<ReporteMercadoLibre> {
  const db = dbPara(ctx.panelId);
  const where = Prisma.sql`v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
    AND v."medioPago" = 'MERCADO_LIBRE'
    AND v."fecha" >= ${ts(r.inicio)} AND v."fecha" < ${ts(r.fin)}`;
  // Por ítem: neto en pesos; USDT y dólares con la cotización de SU venta;
  // costo en USDT el congelado del ítem. Se redondea solo la suma final.
  const neto = SQL_NETO_ITEM;
  const [totales, unidades, dias, crudas] = await Promise.all([
    db.$queryRaw`
      SELECT COUNT(*) AS ventas, ${SQL_SUMA_TOTAL}, ${SQL_SUMA_GANANCIA}
      FROM "Venta" v WHERE ${where}`,
    db.$queryRaw`
      SELECT COALESCE(SUM(vi."cantidad"), 0) AS unidades,
             COALESCE(SUM(vi."cantidad") FILTER (WHERE vi."origenPrecio" = 'ML'), 0) AS unidades_ml
      FROM "VentaItem" vi JOIN "Venta" v ON v."id" = vi."ventaId" WHERE ${where}`,
    db.$queryRaw`
      SELECT to_char((v."fecha" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS dia,
             COUNT(*) AS ventas, ${SQL_SUMA_TOTAL}
      FROM "Venta" v WHERE ${where}
      GROUP BY 1 ORDER BY 1`,
    db.$queryRaw`
      SELECT p."id" AS producto_id, p."nombreCompleto" AS producto, va."nombre" AS sabor,
             SUM(vi."cantidad") AS unidades,
             ROUND(SUM(${neto} / v."tipoCambioUsdt"), 2) AS total_usdt,
             ROUND(SUM(${neto}), 2) AS total_pesos,
             ROUND(SUM(${neto} / v."tipoCambioUsd"), 2) AS total_usd,
             ROUND(SUM(${neto} / v."tipoCambioUsdt" - vi."costoUnitarioUsdt" * vi."cantidad"), 2) AS ganancia_usdt,
             ROUND(SUM(${neto} - vi."costoUnitario" * vi."cantidad"), 2) AS ganancia_pesos,
             ROUND(SUM((${neto} - vi."costoUnitario" * vi."cantidad") / v."tipoCambioUsd"), 2) AS ganancia_usd
      FROM "VentaItem" vi
      JOIN "Venta" v ON v."id" = vi."ventaId"
      JOIN "Variante" va ON va."id" = vi."varianteId"
      JOIN "Producto" p ON p."id" = vi."productoId"
      WHERE ${where}
      GROUP BY 1, 2, 3
      ORDER BY total_usdt DESC, producto, sabor`,
  ]);
  const t = z
    .array(
      z.object({
        ventas: entero,
        total_usdt: monto,
        total_pesos: monto,
        total_usd: monto,
        ganancia_usdt: monto,
        ganancia_pesos: monto,
        ganancia_usd: monto,
      }),
    )
    .parse(totales)[0]!;
  const u = z.array(z.object({ unidades: entero, unidades_ml: entero })).parse(unidades)[0]!;
  return {
    total: {
      ventas: t.ventas,
      unidades: u.unidades,
      facturado: M(t.total_usdt, t.total_pesos, t.total_usd),
      ganancia: opciones.owner ? M(t.ganancia_usdt, t.ganancia_pesos, t.ganancia_usd) : null,
      unidadesPrecioML: u.unidades_ml,
    },
    porDia: porDiaSchema.parse(dias).map((d) => ({
      dia: d.dia,
      ventas: d.ventas,
      facturado: M(d.total_usdt, d.total_pesos, d.total_usd),
    })),
    filas: z
      .array(
        z.object({
          producto_id: z.string(),
          producto: z.string(),
          sabor: z.string(),
          unidades: entero,
          total_usdt: monto,
          total_pesos: monto,
          total_usd: monto,
          ganancia_usdt: monto,
          ganancia_pesos: monto,
          ganancia_usd: monto,
        }),
      )
      .parse(crudas)
      .map((x) => ({
        productoId: x.producto_id,
        producto: x.producto,
        sabor: x.sabor,
        unidades: x.unidades,
        facturado: M(x.total_usdt, x.total_pesos, x.total_usd),
        ganancia: opciones.owner ? M(x.ganancia_usdt, x.ganancia_pesos, x.ganancia_usd) : null,
      })),
  };
}

// =============================================================================
// Opciones de filtros
// =============================================================================

export async function opcionesFiltros(ctx: Ctx) {
  const db = dbPara(ctx.panelId);
  const [depositos, vendedores, proveedores, marcas] = await Promise.all([
    db.deposito.findMany({
      where: { activo: true },
      orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
      select: { id: true, nombre: true },
    }),
    z.array(z.object({ id: z.string(), nombre: z.string() })).parse(
      await db.$queryRaw`
          SELECT u."id", u."nombre" FROM "Usuario" u
          WHERE EXISTS (SELECT 1 FROM "Venta" v WHERE v."panelId" = ${ctx.panelId} AND v."vendedorId" = u."id")
          ORDER BY u."nombre"`,
    ),
    db.proveedor.findMany({
      where: { deletedAt: null },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, nombreTienda: true },
    }),
    db.marca.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true },
    }),
  ]);
  return { depositos, vendedores, proveedores, marcas };
}

/** Productos que tienen al menos un precio de proveedor (filtro del historial). */
export async function productosConPrecioProveedor(
  ctx: Ctx,
): Promise<{ id: string; nombre: string }[]> {
  return z.array(z.object({ id: z.string(), nombre: z.string() })).parse(
    await dbPara(ctx.panelId).$queryRaw`
        SELECT DISTINCT p."id", p."nombreCompleto" AS nombre
        FROM "ProveedorProducto" pp JOIN "Producto" p ON p."id" = pp."productoId"
        WHERE pp."panelId" = ${ctx.panelId} AND p."deletedAt" IS NULL
        ORDER BY nombre`,
  );
}
