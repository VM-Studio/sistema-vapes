import { EstadoVenta, MedioPago, Prisma } from "@prisma/client";

import { ahora } from "@/lib/reloj";
import { nombreConSabor } from "@/lib/ventas-ui";
import { diaEn, limitesRango, sumarDias, ZONA_DEFAULT, type DiaISO } from "@/lib/zona-horaria";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";

/**
 * INICIO DEL PANEL: métricas calculadas directo sobre Venta / VentaItem /
 * Stock (el volumen no justifica tablas de resumen). Los días se cortan en la
 * zona horaria del negocio. Costo y ganancia bruta solo viajan si quien llama
 * es dueño (`conCostos`): a un empleado nunca le llegan.
 */

const dec = (d: Prisma.Decimal | string | number | null | undefined) =>
  new Prisma.Decimal(d ?? 0).toFixed(2);

export interface KpiVentas {
  cantidad: number;
  total: string;
  /** Cobrado por medio de pago (efectivo, transferencia, Binance). */
  porMedio: { medio: MedioPago; cantidad: number; total: string }[];
  /** null = sin permiso para ver costos (no es dueño). */
  costo: string | null;
  ganancia: string | null;
}

export interface ProductoTop {
  productoId: string;
  nombre: string;
  unidades: number;
  total: string;
}

export interface AlertaStock {
  varianteId: string;
  productoId: string;
  nombre: string;
  sku: string;
  stockTotal: number;
  stockMinimo: number;
}

export interface VentaReciente {
  id: string;
  /** ID visible (VAP-000001). */
  codigo: string;
  fecha: Date;
  cliente: string;
  vendedor: string;
  medioPago: MedioPago;
  total: string;
  unidades: number;
}

export interface DashboardPanel {
  hoy: DiaISO;
  kpis: { hoy: KpiVentas; semana: KpiVentas; mes: KpiVentas };
  topProductos: ProductoTop[];
  alertas: AlertaStock[];
  alertasTotal: number;
  ultimasVentas: VentaReciente[];
}

/** Zona horaria del negocio (ConfiguracionGlobal.timezone) o la de Buenos Aires. */
export async function zonaHorariaNegocio(ctx: Ctx): Promise<string> {
  const fila = await dbPara(ctx.panelId).configuracionGlobal.findUnique({
    where: { clave: "timezone" },
    select: { valor: true },
  });
  const tz = typeof fila?.valor === "string" ? fila.valor : null;
  if (!tz) return ZONA_DEFAULT;
  try {
    new Intl.DateTimeFormat("es-AR", { timeZone: tz });
    return tz;
  } catch {
    return ZONA_DEFAULT;
  }
}

async function kpi(
  ctx: Ctx,
  rango: { inicio: Date; fin: Date },
  conCostos: boolean,
): Promise<KpiVentas> {
  const db = dbPara(ctx.panelId);
  const where = { estado: EstadoVenta.CONFIRMADA, fecha: { gte: rango.inicio, lt: rango.fin } };
  const [r, medios] = await Promise.all([
    db.venta.aggregate({
      where,
      _count: { _all: true },
      _sum: { total: true, costoTotal: true, gananciaBruta: true },
    }),
    db.venta.groupBy({
      by: ["medioPago"],
      where,
      _count: { _all: true },
      _sum: { total: true },
    }),
  ]);
  const porMedio = new Map(medios.map((m) => [m.medioPago, m]));
  return {
    cantidad: r._count._all,
    total: dec(r._sum.total),
    porMedio: Object.values(MedioPago).map((medio) => ({
      medio,
      cantidad: porMedio.get(medio)?._count._all ?? 0,
      total: dec(porMedio.get(medio)?._sum.total),
    })),
    costo: conCostos ? dec(r._sum.costoTotal) : null,
    ganancia: conCostos ? dec(r._sum.gananciaBruta) : null,
  };
}

async function topProductos(ctx: Ctx, rango: { inicio: Date; fin: Date }): Promise<ProductoTop[]> {
  const filas = await dbPara(ctx.panelId).$queryRaw<
    { productoId: string; nombre: string; unidades: number; total: Prisma.Decimal }[]
  >`
    SELECT p."id" AS "productoId", p."nombreCompleto" AS "nombre",
           SUM(vi."cantidad")::integer AS "unidades", SUM(vi."subtotal") AS "total"
    FROM "VentaItem" vi
    JOIN "Venta" v ON v."id" = vi."ventaId"
    JOIN "Producto" p ON p."id" = vi."productoId"
    WHERE vi."panelId" = ${ctx.panelId}
      AND v."panelId" = ${ctx.panelId}
      AND v."estado" = 'CONFIRMADA'
      AND v."fecha" >= ${rango.inicio} AND v."fecha" < ${rango.fin}
    GROUP BY p."id", p."nombreCompleto"
    ORDER BY "unidades" DESC, "total" DESC
    LIMIT 5
  `;
  return filas.map((f) => ({ ...f, total: dec(f.total) }));
}

async function alertasStock(ctx: Ctx): Promise<{ alertas: AlertaStock[]; total: number }> {
  const db = dbPara(ctx.panelId);
  const [filas, [conteo]] = await Promise.all([
    db.$queryRaw<
      {
        varianteId: string;
        productoId: string;
        producto: string;
        variante: string;
        sku: string;
        stockTotal: number;
        stockMinimo: number;
      }[]
    >`
      SELECT a.variante_id AS "varianteId", a.producto_id AS "productoId",
             a.producto AS "producto", a.variante AS "variante",
             a.sku AS "sku",
             a.stock_total AS "stockTotal", a.stock_minimo AS "stockMinimo"
      FROM vw_alertas_stock a
      WHERE a.panel_id = ${ctx.panelId}
      ORDER BY a.stock_total ASC, a.faltante DESC, a.producto ASC
      LIMIT 6
    `,
    db.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::integer AS "total" FROM vw_alertas_stock WHERE panel_id = ${ctx.panelId}
    `,
  ]);
  return {
    total: conteo?.total ?? 0,
    alertas: filas.map((f) => ({
      varianteId: f.varianteId,
      productoId: f.productoId,
      nombre: nombreConSabor(f.producto, f.variante),
      sku: f.sku,
      stockTotal: f.stockTotal,
      stockMinimo: f.stockMinimo,
    })),
  };
}

async function ultimasVentas(ctx: Ctx): Promise<VentaReciente[]> {
  const ventas = await dbPara(ctx.panelId).venta.findMany({
    where: { estado: EstadoVenta.CONFIRMADA },
    orderBy: [{ fecha: "desc" }, { numero: "desc" }],
    take: 5,
    select: {
      id: true,
      codigo: true,
      fecha: true,
      total: true,
      medioPago: true,
      cliente: { select: { nombre: true } },
      vendedor: { select: { nombre: true } },
      items: { select: { cantidad: true } },
    },
  });
  return ventas.map((v) => ({
    id: v.id,
    codigo: v.codigo,
    fecha: v.fecha,
    cliente: v.cliente.nombre,
    vendedor: v.vendedor.nombre,
    medioPago: v.medioPago,
    total: dec(v.total),
    unidades: v.items.reduce((a, i) => a + i.cantidad, 0),
  }));
}

/** Todo el inicio del panel en una llamada (consultas en paralelo). */
export async function obtenerDashboard(
  ctx: Ctx,
  opciones: { conCostos: boolean },
): Promise<DashboardPanel> {
  const tz = await zonaHorariaNegocio(ctx);
  const hoy = diaEn(ahora(), tz);
  const rangoHoy = limitesRango(hoy, hoy, tz);
  const rangoSemana = limitesRango(sumarDias(hoy, -6), hoy, tz);
  const rangoMes = limitesRango(`${hoy.slice(0, 8)}01`, hoy, tz);

  const [kHoy, kSemana, kMes, top, alertas, ultimas] = await Promise.all([
    kpi(ctx, rangoHoy, opciones.conCostos),
    kpi(ctx, rangoSemana, opciones.conCostos),
    kpi(ctx, rangoMes, opciones.conCostos),
    topProductos(ctx, rangoMes),
    alertasStock(ctx),
    ultimasVentas(ctx),
  ]);
  return {
    hoy,
    kpis: { hoy: kHoy, semana: kSemana, mes: kMes },
    topProductos: top,
    alertas: alertas.alertas,
    alertasTotal: alertas.total,
    ultimasVentas: ultimas,
  };
}
