import "server-only";

import {
  EstadoCompra,
  Prisma,
  type EstadoVenta,
  type MedioPago,
  type TipoMovimiento,
  type TipoVenta,
} from "@prisma/client";
import { z } from "zod";

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

/**
 * REPORTES del panel (4 a 9). Todo se agrega en PostgreSQL ($queryRaw con
 * `"panelId" = ctx.panelId` explícito, resultados validados con Zod); Node
 * solo presenta. Costos, ganancias y totales comprados: el que llama decide
 * (`owner`) y acá se devuelven `null` si no corresponde.
 */

const num = z.union([z.number(), z.bigint(), z.string(), z.instanceof(Prisma.Decimal)]);
const monto = num.transform((v) => new Prisma.Decimal(v.toString()).toFixed(2));
const entero = num.transform((v) => Number(v));
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
  total: string;
  ganancia: string | null;
}

export interface ReporteVentas {
  filas: VentaReporte[];
  cantidad: number;
  page: number;
  pageSize: number;
  resumen: { ventas: number; unidades: number; total: string; ganancia: string | null };
  porDia: { dia: string; ventas: number; total: string }[];
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
    medio_pago: z.enum(["EFECTIVO", "TRANSFERENCIA", "BINANCE"]).nullable(),
    estado: z.enum(["CONFIRMADA", "ANULADA"]),
    unidades: entero,
    total: monto,
    ganancia: monto,
  }),
);
const resumenVentasSchema = z.array(
  z.object({ ventas: entero, unidades: entero, total: monto, ganancia: monto }),
);
const porDiaSchema = z.array(z.object({ dia: z.string(), ventas: entero, total: monto }));

export async function reporteVentas(
  ctx: Ctx,
  r: RangoReporte,
  f: FiltrosVentasReporte,
  opciones: { owner: boolean; exportar?: boolean },
): Promise<ReporteVentas> {
  const db = dbPara(ctx.panelId);
  const where = whereVentas(ctx, r, f);
  const pageSize = opciones.exportar ? MAX_FILAS_EXPORTACION : POR_PAGINA;
  const offset = opciones.exportar ? 0 : (f.page - 1) * POR_PAGINA;
  const [filas, resumen, porDia] = await Promise.all([
    db.$queryRaw`
      SELECT v."id", v."codigo", v."fecha", c."nombre" AS cliente, u."nombre" AS vendedor,
             d."nombre" AS deposito, v."tipo"::text AS tipo, v."medioPago"::text AS medio_pago,
             v."estado"::text AS estado,
             COALESCE((SELECT SUM(vi."cantidad") FROM "VentaItem" vi WHERE vi."ventaId" = v."id"), 0) AS unidades,
             v."total", v."gananciaBruta" AS ganancia
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
             COALESCE(SUM(v."total"), 0) AS total, COALESCE(SUM(v."gananciaBruta"), 0) AS ganancia
      FROM "Venta" v WHERE ${where}`,
    db.$queryRaw`
      SELECT to_char(v."fecha" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS dia,
             COUNT(*) AS ventas, COALESCE(SUM(v."total"), 0) AS total
      FROM "Venta" v WHERE ${where}
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
      total: v.total,
      ganancia: opciones.owner ? v.ganancia : null,
    })),
    cantidad: res.ventas,
    page: f.page,
    pageSize,
    resumen: {
      ventas: res.ventas,
      unidades: res.unidades,
      total: res.total,
      ganancia: opciones.owner ? res.ganancia : null,
    },
    porDia: porDiaSchema.parse(porDia),
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
  total: string;
  ultima: Date | null;
}

const filaCompraProvSchema = z.array(
  z.object({
    proveedor_id: z.string().nullable(),
    proveedor: z.string().nullable(),
    tienda: z.string().nullable(),
    compras: entero,
    unidades: entero,
    total: monto,
    ultima: z.date().nullable(),
  }),
);

export async function comprasPorProveedor(
  ctx: Ctx,
  r: RangoReporte,
  f: FiltrosComprasReporte,
): Promise<CompraPorProveedor[]> {
  const crudas = await dbPara(ctx.panelId).$queryRaw`
    SELECT c."proveedorId" AS proveedor_id, pr."nombre" AS proveedor, pr."nombreTienda" AS tienda,
           COUNT(*) AS compras,
           COALESCE(SUM((SELECT SUM(ci."cantidad") FROM "CompraItem" ci WHERE ci."compraId" = c."id")), 0) AS unidades,
           COALESCE(SUM(c."total"), 0) AS total, MAX(c."fecha") AS ultima
    FROM "Compra" c
    LEFT JOIN "Proveedor" pr ON pr."id" = c."proveedorId"
    WHERE c."panelId" = ${ctx.panelId} AND c."estado" = ${EstadoCompra.RECIBIDA}::"EstadoCompra"
      AND c."fecha" >= ${ts(r.inicio)} AND c."fecha" < ${ts(r.fin)}
      ${f.proveedorId ? Prisma.sql`AND c."proveedorId" = ${f.proveedorId}` : Prisma.empty}
    GROUP BY 1, 2, 3
    ORDER BY total DESC`;
  return filaCompraProvSchema.parse(crudas).map((x) => ({
    proveedorId: x.proveedor_id,
    proveedor: x.proveedor ?? "Sin proveedor",
    tienda: x.tienda,
    compras: x.compras,
    unidades: x.unidades,
    total: x.total,
    ultima: x.ultima,
  }));
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
        total: string;
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
                 SUM(v."total") AS total
          FROM "Venta" v JOIN "Cliente" c ON c."id" = v."clienteId"
          WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
            AND v."fecha" >= ${ts(r.inicio)} AND v."fecha" < ${ts(r.fin)}
          GROUP BY c."id", c."nombre", c."telefono"
          ORDER BY total DESC
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
                total: monto,
              }),
            )
            .parse(top),
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
