import {
  AccionAuditoria,
  EstadoDevolucion,
  EstadoLiquidacion,
  EstadoVenta,
  MedioPago,
  Prisma,
  RolUsuario,
} from "@prisma/client";
import ExcelJS from "exceljs";
import { z } from "zod";

import {
  calcularGanancia,
  CATEGORIAS_GANANCIA,
  ETIQUETA_CATEGORIA,
  fechaDeMes,
  limitesMes,
  mesDe,
  mesDeFecha,
  nombreMes,
  sumarMeses,
  type CalculoGanancia,
  type DevolucionParaGanancia,
  type FilaGanancia,
  type Mes,
  type ResumenCategoria,
  type Tarifas,
  type VentaParaGanancia,
} from "@/lib/ganancia-vendedor";
import { esOwner, veFacturado, type SujetoPermisos } from "@/lib/permisos";
import { ahora } from "@/lib/reloj";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { ZONA_DEFAULT } from "@/lib/zona-horaria";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";

/**
 * GANANCIA POR UNIDAD DE LOS VENDEDORES y su LIQUIDACIÓN MENSUAL (por panel).
 *
 * - Tarifas ($ por unidad, 4 categorías) en TarifaVendedor: las cargan los
 *   dueños desde Equipo → {vendedor}. Sin tarifas, el vendedor no tiene
 *   ganancia por unidad (no se muestra la sección).
 * - El mes en curso se calcula EN VIVO con las tarifas vigentes (siempre al
 *   día): ventas CONFIRMADAS del vendedor en el mes argentino menos las
 *   devoluciones del mes (criterio en src/lib/ganancia-vendedor.ts).
 * - Mes terminado → LiquidacionVendedor (única por panel + vendedor + mes)
 *   con el snapshot de tarifas, categorías y ventas. La genera el sistema
 *   sola (cron del día 1 y, por las dudas, al abrir la pantalla) para los
 *   meses desde que el vendedor tiene tarifas; un dueño la puede generar a
 *   mano para un mes terminado anterior, o recalcularla mientras está
 *   PENDIENTE. PENDIENTE → PAGADA al registrar el pago (solo dueños). Pagada,
 *   el snapshot no cambia (trigger).
 * - Lo ve cada dueño de cualquier vendedor y el vendedor lo suyo.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dec = (v: Prisma.Decimal | string | number) => D(v).toFixed(2);

/** Cuántos meses para atrás genera solo el sistema (el resto, a mano). */
const MAX_MESES_AUTOMATICOS = 12;

type CtxConUsuario = Ctx & { usuario?: Pick<SujetoPermisos, "rol"> };

async function esOwnerCtx(ctx: CtxConUsuario): Promise<boolean> {
  if (ctx.usuario) return esOwner(ctx.usuario);
  const u = await dbPara(ctx.panelId).usuario.findUnique({
    where: { id: ctx.usuarioId },
    select: { rol: true },
  });
  return u?.rol === RolUsuario.OWNER;
}

async function exigirOwner(ctx: CtxConUsuario, que: string): Promise<void> {
  if (!(await esOwnerCtx(ctx))) throw new ForbiddenError(`${que}: solo los dueños.`);
}

/** Un dueño ve a cualquiera; un vendedor, solo lo suyo. */
async function exigirVer(ctx: CtxConUsuario, usuarioId: string): Promise<void> {
  if (ctx.usuarioId === usuarioId) return;
  await exigirOwner(ctx, "La ganancia de otro vendedor");
}

export const mesActual = (): Mes => mesDe(ahora());
export const mesTerminado = (mes: Mes): boolean => mes < mesActual();

// =============================================================================
// Tarifas
// =============================================================================

const aTarifas = (t: {
  minorista: Prisma.Decimal;
  mayorista: Prisma.Decimal;
  minoristaNuevo: Prisma.Decimal;
  mayoristaNuevo: Prisma.Decimal;
}): Tarifas => ({
  minorista: dec(t.minorista),
  mayorista: dec(t.mayorista),
  minoristaNuevo: dec(t.minoristaNuevo),
  mayoristaNuevo: dec(t.mayoristaNuevo),
});

export interface TarifasVendedor extends Tarifas {
  /** Desde cuándo las tiene (los meses anteriores no se liquidan solos). */
  desde: Date;
  actualizadaAt: Date;
}

export async function obtenerTarifas(
  ctx: CtxConUsuario,
  usuarioId: string,
): Promise<TarifasVendedor | null> {
  await exigirVer(ctx, usuarioId);
  const t = await dbPara(ctx.panelId).tarifaVendedor.findUnique({
    where: { panelId_usuarioId: { panelId: ctx.panelId, usuarioId } },
  });
  return t ? { ...aTarifas(t), desde: t.createdAt, actualizadaAt: t.updatedAt } : null;
}

export const tarifasSchema = z.object({
  minorista: z.coerce.number().min(0).max(10_000_000),
  mayorista: z.coerce.number().min(0).max(10_000_000),
  minoristaNuevo: z.coerce.number().min(0).max(10_000_000),
  mayoristaNuevo: z.coerce.number().min(0).max(10_000_000),
});

/** Crea o cambia las tarifas (solo dueños). Afecta el mes en curso y los que no se liquidaron. */
export async function guardarTarifas(
  ctx: CtxConUsuario,
  usuarioId: string,
  input: z.input<typeof tarifasSchema>,
): Promise<void> {
  await exigirOwner(ctx, "Cambiar la ganancia por unidad");
  const t = tarifasSchema.parse(input);
  await transaccion(ctx, async (tx) => {
    const u = await tx.usuario.findUnique({
      where: { id: usuarioId },
      select: { rol: true, deletedAt: true },
    });
    if (!u || u.deletedAt) throw new NotFoundError("El usuario no existe");
    if (u.rol === RolUsuario.OWNER)
      throw new DomainError("Los dueños no tienen ganancia por unidad");
    const antes = await tx.tarifaVendedor.findUnique({
      where: { panelId_usuarioId: { panelId: ctx.panelId, usuarioId } },
    });
    const datos = {
      minorista: D(t.minorista),
      mayorista: D(t.mayorista),
      minoristaNuevo: D(t.minoristaNuevo),
      mayoristaNuevo: D(t.mayoristaNuevo),
      actualizadaPorId: ctx.usuarioId,
    };
    const fila = await tx.tarifaVendedor.upsert({
      where: { panelId_usuarioId: { panelId: ctx.panelId, usuarioId } },
      update: datos,
      create: { usuarioId, ...datos },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: antes ? AccionAuditoria.UPDATE : AccionAuditoria.CREATE,
      entidad: "TarifaVendedor",
      entidadId: fila.id,
      datosAntes: antes ? { usuarioId, ...aTarifas(antes) } : null,
      datosDespues: { usuarioId, ...aTarifas(fila) },
      meta: ctx.meta,
    });
  });
}

/** Saca la ganancia por unidad del vendedor (las liquidaciones ya generadas quedan). */
export async function quitarTarifas(ctx: CtxConUsuario, usuarioId: string): Promise<void> {
  await exigirOwner(ctx, "Quitar la ganancia por unidad");
  await transaccion(ctx, async (tx) => {
    const antes = await tx.tarifaVendedor.findUnique({
      where: { panelId_usuarioId: { panelId: ctx.panelId, usuarioId } },
    });
    if (!antes) return;
    await tx.tarifaVendedor.delete({ where: { id: antes.id } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.DELETE,
      entidad: "TarifaVendedor",
      entidadId: antes.id,
      datosAntes: { usuarioId, ...aTarifas(antes) },
      meta: ctx.meta,
    });
  });
}

// =============================================================================
// Datos del mes y cálculo
// =============================================================================

type Db = ReturnType<typeof dbPara> | Tx;

async function datosDelMes(
  db: Db,
  usuarioId: string,
  mes: Mes,
): Promise<{ ventas: VentaParaGanancia[]; devoluciones: DevolucionParaGanancia[] }> {
  const { inicio, fin } = limitesMes(mes);
  const [ventas, devoluciones] = await Promise.all([
    db.venta.findMany({
      where: {
        vendedorId: usuarioId,
        estado: EstadoVenta.CONFIRMADA,
        fecha: { gte: inicio, lt: fin },
      },
      orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      select: {
        id: true,
        codigo: true,
        fecha: true,
        tipo: true,
        clienteNuevo: true,
        total: true,
        cliente: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
    db.devolucion.findMany({
      where: {
        estado: EstadoDevolucion.REGISTRADA,
        fecha: { gte: inicio, lt: fin },
        venta: { vendedorId: usuarioId, estado: EstadoVenta.CONFIRMADA },
      },
      select: {
        id: true,
        codigo: true,
        fecha: true,
        ventaId: true,
        cliente: { select: { nombre: true } },
        venta: { select: { codigo: true, tipo: true, clienteNuevo: true } },
        items: { select: { cantidad: true } },
      },
    }),
  ]);
  return {
    ventas: ventas.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      tipo: v.tipo,
      clienteNuevo: v.clienteNuevo,
      cliente: v.cliente.nombre,
      unidades: v.items.reduce((s, i) => s + i.cantidad, 0),
      total: dec(v.total),
    })),
    devoluciones: devoluciones.flatMap((d) =>
      d.venta && d.ventaId
        ? [
            {
              id: d.id,
              codigo: d.codigo,
              fecha: d.fecha,
              ventaId: d.ventaId,
              ventaCodigo: d.venta.codigo,
              tipo: d.venta.tipo,
              clienteNuevo: d.venta.clienteNuevo,
              cliente: d.cliente.nombre,
              unidades: d.items.reduce((s, i) => s + i.cantidad, 0),
            },
          ]
        : [],
    ),
  };
}

// --- Snapshot (JSON de la liquidación) ---------------------------------------

const categoriaSchema = z.enum(CATEGORIAS_GANANCIA);
const resumenSchema = z.object({
  categoria: categoriaSchema,
  ventas: z.number().int(),
  unidades: z.number().int(),
  unidadesDevueltas: z.number().int(),
  tarifa: z.string(),
  monto: z.string(),
  totalVendido: z.string(),
});
const filaSchema = z.object({
  tipo: z.enum(["VENTA", "DEVOLUCION"]),
  id: z.string(),
  codigo: z.string(),
  ventaId: z.string(),
  ventaCodigo: z.string(),
  fecha: z.coerce.date(),
  cliente: z.string(),
  categoria: categoriaSchema,
  unidades: z.number().int(),
  tarifa: z.string(),
  ganancia: z.string(),
  totalVenta: z.string(),
});

const filaLiquidacion = {
  id: true,
  usuarioId: true,
  mes: true,
  estado: true,
  tarifaMinorista: true,
  tarifaMayorista: true,
  tarifaMinoristaNuevo: true,
  tarifaMayoristaNuevo: true,
  total: true,
  cantidadVentas: true,
  unidades: true,
  totalVendido: true,
  categorias: true,
  detalle: true,
  generadaAt: true,
  montoPagado: true,
  medioPago: true,
  referencia: true,
  fechaPago: true,
  pagadaAt: true,
  generadaPor: { select: { nombre: true } },
  pagadaPor: { select: { id: true, nombre: true } },
  usuario: { select: { id: true, nombre: true, email: true } },
} satisfies Prisma.LiquidacionVendedorSelect;

type FilaLiquidacionDb = Prisma.LiquidacionVendedorGetPayload<{ select: typeof filaLiquidacion }>;

export interface Liquidacion {
  id: string;
  usuario: { id: string; nombre: string; email: string };
  mes: Mes;
  estado: EstadoLiquidacion;
  total: string;
  cantidadVentas: number;
  unidades: number;
  totalVendido: string;
  generadaAt: Date;
  /** null = la generó el sistema al terminar el mes. */
  generadaPor: string | null;
  pago: {
    monto: string;
    medioPago: MedioPago;
    referencia: string | null;
    fecha: Date;
    registradoAt: Date;
    registradoPor: { id: string; nombre: string };
  } | null;
}

function aLiquidacion(l: FilaLiquidacionDb): Liquidacion {
  return {
    id: l.id,
    usuario: l.usuario,
    mes: mesDeFecha(l.mes),
    estado: l.estado,
    total: dec(l.total),
    cantidadVentas: l.cantidadVentas,
    unidades: l.unidades,
    totalVendido: dec(l.totalVendido),
    generadaAt: l.generadaAt,
    generadaPor: l.generadaPor?.nombre ?? null,
    pago:
      l.estado !== EstadoLiquidacion.PENDIENTE &&
      l.montoPagado &&
      l.medioPago &&
      l.fechaPago &&
      l.pagadaAt &&
      l.pagadaPor
        ? {
            monto: dec(l.montoPagado),
            medioPago: l.medioPago,
            referencia: l.referencia,
            fecha: l.fechaPago,
            registradoAt: l.pagadaAt,
            registradoPor: l.pagadaPor,
          }
        : null,
  };
}

function calculoDeSnapshot(l: FilaLiquidacionDb): CalculoGanancia {
  return {
    tarifas: {
      minorista: dec(l.tarifaMinorista),
      mayorista: dec(l.tarifaMayorista),
      minoristaNuevo: dec(l.tarifaMinoristaNuevo),
      mayoristaNuevo: dec(l.tarifaMayoristaNuevo),
    },
    categorias: z.array(resumenSchema).parse(l.categorias) as ResumenCategoria[],
    filas: z.array(filaSchema).parse(l.detalle) as FilaGanancia[],
    total: dec(l.total),
    cantidadVentas: l.cantidadVentas,
    unidades: l.unidades,
    totalVendido: dec(l.totalVendido),
  };
}

function datosSnapshot(c: CalculoGanancia) {
  return {
    tarifaMinorista: D(c.tarifas.minorista),
    tarifaMayorista: D(c.tarifas.mayorista),
    tarifaMinoristaNuevo: D(c.tarifas.minoristaNuevo),
    tarifaMayoristaNuevo: D(c.tarifas.mayoristaNuevo),
    total: D(c.total),
    cantidadVentas: c.cantidadVentas,
    unidades: c.unidades,
    totalVendido: D(c.totalVendido),
    categorias: c.categorias as unknown as Prisma.InputJsonValue,
    detalle: c.filas.map((f) => ({
      ...f,
      fecha: f.fecha.toISOString(),
    })) as unknown as Prisma.InputJsonValue,
  };
}

// =============================================================================
// Generación de liquidaciones
// =============================================================================

/**
 * Genera (o recalcula, si está PENDIENTE) la liquidación del mes con las
 * tarifas vigentes. `porId` null = el sistema. Dentro de `tx`.
 */
async function generarEnTx(
  tx: Tx,
  ctx: Ctx,
  usuarioId: string,
  mes: Mes,
  porId: string | null,
): Promise<{ id: string; creada: boolean }> {
  const tarifa = await tx.tarifaVendedor.findUnique({
    where: { panelId_usuarioId: { panelId: ctx.panelId, usuarioId } },
  });
  if (!tarifa) throw new DomainError("El vendedor no tiene ganancia por unidad cargada");
  // Una sola generación a la vez por vendedor y mes (cron + pantalla).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`liq:${ctx.panelId}:${usuarioId}:${mes}`}))`;
  const existente = await tx.liquidacionVendedor.findUnique({
    where: {
      panelId_usuarioId_mes: { panelId: ctx.panelId, usuarioId, mes: fechaDeMes(mes) },
    },
    select: { id: true, estado: true, total: true },
  });
  if (existente && existente.estado !== EstadoLiquidacion.PENDIENTE)
    throw new DomainError("La liquidación de ese mes ya está pagada: no se recalcula");
  const { ventas, devoluciones } = await datosDelMes(tx, usuarioId, mes);
  const calculo = calcularGanancia(aTarifas(tarifa), ventas, devoluciones);
  const datos = { ...datosSnapshot(calculo), generadaPorId: porId, generadaAt: ahora() };
  const fila = existente
    ? await tx.liquidacionVendedor.update({ where: { id: existente.id }, data: datos })
    : await tx.liquidacionVendedor.create({
        data: { usuarioId, mes: fechaDeMes(mes), ...datos },
      });
  await registrarAuditoria(tx, {
    usuarioId: porId,
    accion: existente ? AccionAuditoria.UPDATE : AccionAuditoria.CREATE,
    entidad: "LiquidacionVendedor",
    entidadId: fila.id,
    datosAntes: existente ? { total: dec(existente.total) } : null,
    datosDespues: {
      usuarioId,
      mes,
      total: calculo.total,
      cantidadVentas: calculo.cantidadVentas,
      unidades: calculo.unidades,
      automatica: porId === null,
    },
    meta: ctx.meta,
  });
  return { id: fila.id, creada: !existente };
}

/** Un dueño genera (o recalcula, si sigue pendiente) la liquidación de un mes terminado. */
export async function generarLiquidacion(
  ctx: CtxConUsuario,
  usuarioId: string,
  mes: Mes,
): Promise<{ id: string; creada: boolean }> {
  await exigirOwner(ctx, "Generar una liquidación");
  if (!mesTerminado(mes))
    throw new DomainError("El mes todavía no terminó: se liquida a partir del día 1 del siguiente");
  return transaccion(ctx, (tx) => generarEnTx(tx, ctx, usuarioId, mes, ctx.usuarioId));
}

/**
 * Cierre automático: genera las liquidaciones que falten de los meses
 * terminados desde que el vendedor tiene tarifas (hasta 12 para atrás).
 * Idempotente. Devuelve cuántas creó.
 */
export async function asegurarLiquidaciones(ctx: Ctx, usuarioId: string): Promise<number> {
  const db = dbPara(ctx.panelId);
  const tarifa = await db.tarifaVendedor.findUnique({
    where: { panelId_usuarioId: { panelId: ctx.panelId, usuarioId } },
    select: { createdAt: true },
  });
  if (!tarifa) return 0;
  const hasta = sumarMeses(mesActual(), -1);
  let desde = mesDe(tarifa.createdAt);
  const tope = sumarMeses(hasta, -(MAX_MESES_AUTOMATICOS - 1));
  if (desde < tope) desde = tope;
  if (desde > hasta) return 0;
  const existentes = new Set(
    (
      await db.liquidacionVendedor.findMany({
        where: { usuarioId, mes: { gte: fechaDeMes(desde), lte: fechaDeMes(hasta) } },
        select: { mes: true },
      })
    ).map((l) => mesDeFecha(l.mes)),
  );
  let creadas = 0;
  for (let m = desde; m <= hasta; m = sumarMeses(m, 1)) {
    if (existentes.has(m)) continue;
    const r = await transaccion(ctx, async (tx) => {
      const ya = await tx.liquidacionVendedor.findUnique({
        where: { panelId_usuarioId_mes: { panelId: ctx.panelId, usuarioId, mes: fechaDeMes(m) } },
        select: { id: true },
      });
      if (ya) return { creada: false };
      return generarEnTx(tx, ctx, usuarioId, m, null);
    });
    if (r.creada) creadas++;
  }
  return creadas;
}

/** Todos los vendedores con tarifas del panel (cron y aviso de los dueños). */
async function asegurarDelPanel(ctx: Ctx): Promise<number> {
  const tarifas = await dbPara(ctx.panelId).tarifaVendedor.findMany({
    select: { usuarioId: true },
  });
  let n = 0;
  for (const t of tarifas) n += await asegurarLiquidaciones(ctx, t.usuarioId);
  return n;
}

/** Cron del día 1: cierra el mes de todos los vendedores con tarifas, en todos los paneles. */
export async function cerrarMesesPendientes(
  paneles: { id: string }[],
): Promise<{ panelId: string; creadas: number }[]> {
  const salida: { panelId: string; creadas: number }[] = [];
  for (const p of paneles) {
    salida.push({
      panelId: p.id,
      creadas: await asegurarDelPanel({ panelId: p.id, usuarioId: "sistema" }),
    });
  }
  return salida;
}

// =============================================================================
// Lectura
// =============================================================================

export interface GananciaMes {
  usuario: { id: string; nombre: string };
  mes: Mes;
  /** El mes en curso (cálculo en vivo, "a hoy"). */
  enCurso: boolean;
  /** El mes terminó (se puede liquidar). */
  terminado: boolean;
  /** Snapshot si el mes ya se liquidó; si no, en vivo con las tarifas vigentes. */
  calculo: CalculoGanancia;
  liquidacion: Liquidacion | null;
  /** Calculado a esta hora. */
  calculadoAt: Date;
}

/**
 * Ganancia de un mes (null si el vendedor no tiene tarifas ni liquidación de
 * ese mes). Antes cierra los meses terminados que falten.
 */
export async function gananciaDelMes(
  ctx: CtxConUsuario,
  usuarioId: string,
  mes: Mes,
): Promise<GananciaMes | null> {
  await exigirVer(ctx, usuarioId);
  const db = dbPara(ctx.panelId);
  await asegurarLiquidaciones(ctx, usuarioId);
  const [usuario, tarifa, liq] = await Promise.all([
    db.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nombre: true } }),
    db.tarifaVendedor.findUnique({
      where: { panelId_usuarioId: { panelId: ctx.panelId, usuarioId } },
    }),
    db.liquidacionVendedor.findUnique({
      where: {
        panelId_usuarioId_mes: { panelId: ctx.panelId, usuarioId, mes: fechaDeMes(mes) },
      },
      select: filaLiquidacion,
    }),
  ]);
  if (!usuario) throw new NotFoundError("El usuario no existe");
  if (!tarifa && !liq) return null;
  const actual = mesActual();
  let calculo: CalculoGanancia;
  if (liq) calculo = calculoDeSnapshot(liq);
  else {
    const { ventas, devoluciones } = await datosDelMes(db, usuarioId, mes);
    calculo = calcularGanancia(aTarifas(tarifa!), ventas, devoluciones);
  }
  return {
    usuario,
    mes,
    enCurso: mes === actual,
    terminado: mes < actual,
    calculo,
    liquidacion: liq ? aLiquidacion(liq) : null,
    calculadoAt: ahora(),
  };
}

/** ¿El vendedor tiene ganancia por unidad en el panel (tarifas o alguna liquidación)? */
export async function tieneGanancia(ctx: Ctx, usuarioId: string): Promise<boolean> {
  const db = dbPara(ctx.panelId);
  const [t, l] = await Promise.all([
    db.tarifaVendedor.count({ where: { usuarioId } }),
    db.liquidacionVendedor.count({ where: { usuarioId } }),
  ]);
  return t + l > 0;
}

/**
 * ¿Quien opera (ctx) ve lo facturado? Dueños sí; un vendedor con ganancia por
 * vape en el panel, no (ve solo su ganancia). Regla pura en lib/permisos.
 */
export async function veFacturadoCtx(ctx: CtxConUsuario): Promise<boolean> {
  if (await esOwnerCtx(ctx)) return true;
  return veFacturado({ rol: RolUsuario.EMPLEADO }, await tieneGanancia(ctx, ctx.usuarioId));
}

/** Historial de liquidaciones del vendedor (la más reciente primero). */
export async function liquidacionesDe(
  ctx: CtxConUsuario,
  usuarioId: string,
): Promise<Liquidacion[]> {
  await exigirVer(ctx, usuarioId);
  const filas = await dbPara(ctx.panelId).liquidacionVendedor.findMany({
    where: { usuarioId },
    orderBy: { mes: "desc" },
    take: 36,
    select: filaLiquidacion,
  });
  return filas.map(aLiquidacion);
}

/**
 * Liquidaciones sin pagar del panel (aviso de "mes cerrado" a los dueños).
 * Cierra antes los meses que falten.
 */
export async function liquidacionesPendientes(ctx: CtxConUsuario): Promise<Liquidacion[]> {
  await exigirOwner(ctx, "Las liquidaciones pendientes");
  await asegurarDelPanel(ctx);
  const filas = await dbPara(ctx.panelId).liquidacionVendedor.findMany({
    where: { estado: EstadoLiquidacion.PENDIENTE },
    orderBy: [{ mes: "desc" }, { usuario: { nombre: "asc" } }],
    select: filaLiquidacion,
  });
  return filas.map(aLiquidacion);
}

export async function obtenerLiquidacion(ctx: CtxConUsuario, id: string): Promise<Liquidacion> {
  const l = await dbPara(ctx.panelId).liquidacionVendedor.findUnique({
    where: { id },
    select: filaLiquidacion,
  });
  if (!l) throw new NotFoundError("La liquidación no existe");
  await exigirVer(ctx, l.usuarioId);
  return aLiquidacion(l);
}

// =============================================================================
// Pago (solo dueños)
// =============================================================================

export interface DatosPagoLiquidacion {
  monto: number;
  medioPago: MedioPago;
  referencia?: string;
  fecha: Date;
}

export async function registrarPagoEnTx(
  tx: Tx,
  ctx: Ctx,
  id: string,
  pago: DatosPagoLiquidacion,
): Promise<{ usuarioId: string; mes: Mes; monto: string }> {
  await tx.$queryRaw`SELECT "id" FROM "LiquidacionVendedor" WHERE "id" = ${id} AND "panelId" = ${ctx.panelId} FOR UPDATE`;
  const l = await tx.liquidacionVendedor.findUnique({
    where: { id },
    select: { estado: true, usuarioId: true, mes: true, total: true },
  });
  if (!l) throw new NotFoundError("La liquidación no existe");
  if (l.estado !== EstadoLiquidacion.PENDIENTE)
    throw new DomainError("Esa liquidación ya tiene el pago registrado");
  if (!(pago.monto > 0)) throw new DomainError("El monto tiene que ser mayor a cero");
  const monto = D(pago.monto).toDecimalPlaces(2);
  await tx.liquidacionVendedor.update({
    where: { id },
    data: {
      estado: EstadoLiquidacion.PAGADA,
      montoPagado: monto,
      medioPago: pago.medioPago,
      referencia: pago.referencia?.trim() || null,
      fechaPago: pago.fecha,
      pagadaPorId: ctx.usuarioId,
      pagadaAt: ahora(),
    },
  });
  await registrarAuditoria(tx, {
    usuarioId: ctx.usuarioId,
    accion: AccionAuditoria.UPDATE,
    entidad: "LiquidacionVendedor",
    entidadId: id,
    datosAntes: { estado: "PENDIENTE", total: dec(l.total) },
    datosDespues: {
      estado: "PAGADA",
      monto: monto.toFixed(2),
      medioPago: pago.medioPago,
      referencia: pago.referencia ?? null,
      fecha: pago.fecha.toISOString(),
    },
    meta: ctx.meta,
  });
  return { usuarioId: l.usuarioId, mes: mesDeFecha(l.mes), monto: monto.toFixed(2) };
}

/** Registra el pago de la liquidación: PENDIENTE → PAGADA (solo dueños). */
export async function registrarPagoLiquidacion(
  ctx: CtxConUsuario,
  id: string,
  pago: DatosPagoLiquidacion,
): Promise<{ usuarioId: string; mes: Mes; monto: string }> {
  await exigirOwner(ctx, "Registrar el pago de una liquidación");
  return transaccion(ctx, (tx) => registrarPagoEnTx(tx, ctx, id, pago));
}

// =============================================================================
// Excel
// =============================================================================

export async function exportarGananciaExcel(
  ctx: CtxConUsuario,
  usuarioId: string,
  mes: Mes,
): Promise<{ buffer: Buffer; nombre: string }> {
  const g = await gananciaDelMes(ctx, usuarioId, mes);
  if (!g) throw new NotFoundError("El vendedor no tiene ganancia por unidad");
  // El vendedor exporta solo su ganancia: sin lo vendido (lo facturado lo ven los dueños).
  const conFacturado = await veFacturadoCtx(ctx);
  const libro = new ExcelJS.Workbook();
  libro.created = new Date();
  const pesos = '"$" #,##0.00';
  const resumen = libro.addWorksheet("Resumen");
  resumen.columns = [
    { header: "Categoría", key: "categoria", width: 28 },
    { header: "Ventas", key: "ventas", width: 10 },
    { header: "Vapes vendidos", key: "unidades", width: 15 },
    { header: "Vapes devueltos", key: "devueltas", width: 16 },
    { header: "Ganancia por vape", key: "tarifa", width: 18, style: { numFmt: pesos } },
    { header: "Ganancia", key: "monto", width: 16, style: { numFmt: pesos } },
    ...(conFacturado
      ? [{ header: "Total vendido", key: "vendido", width: 16, style: { numFmt: pesos } }]
      : []),
  ];
  resumen.getRow(1).font = { bold: true };
  for (const c of g.calculo.categorias)
    resumen.addRow({
      categoria: ETIQUETA_CATEGORIA[c.categoria],
      ventas: c.ventas,
      unidades: c.unidades,
      devueltas: c.unidadesDevueltas,
      tarifa: Number(c.tarifa),
      monto: Number(c.monto),
      ...(conFacturado ? { vendido: Number(c.totalVendido) } : {}),
    });
  const pie = resumen.addRow({
    categoria: "Total",
    ventas: g.calculo.cantidadVentas,
    unidades: g.calculo.categorias.reduce((s, c) => s + c.unidades, 0),
    devueltas: g.calculo.categorias.reduce((s, c) => s + c.unidadesDevueltas, 0),
    monto: Number(g.calculo.total),
    ...(conFacturado ? { vendido: Number(g.calculo.totalVendido) } : {}),
  });
  pie.font = { bold: true };
  resumen.addRow({});
  resumen.addRow({
    categoria: `${g.usuario.nombre} · ${nombreMes(mes)} · ${
      g.liquidacion
        ? g.liquidacion.estado === "PENDIENTE"
          ? "liquidación pendiente de pago"
          : `pagada el ${fechaCorta(g.liquidacion.pago!.fecha)} (${ETIQUETA_MEDIO_PAGO[g.liquidacion.pago!.medioPago]})`
        : g.enCurso
          ? `en curso, calculado el ${fechaCorta(g.calculadoAt)}`
          : "sin liquidar"
    }`,
  });

  const hoja = libro.addWorksheet("Ventas", { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.columns = [
    { header: "Fecha", key: "fecha", width: 18 },
    { header: "Movimiento", key: "tipo", width: 12 },
    { header: "ID", key: "codigo", width: 14 },
    { header: "Venta", key: "venta", width: 14 },
    { header: "Cliente", key: "cliente", width: 28 },
    { header: "Categoría", key: "categoria", width: 26 },
    { header: "Vapes", key: "unidades", width: 8 },
    { header: "Ganancia por vape", key: "tarifa", width: 18, style: { numFmt: pesos } },
    { header: "Ganancia", key: "ganancia", width: 14, style: { numFmt: pesos } },
    ...(conFacturado
      ? [{ header: "Total de la venta", key: "total", width: 16, style: { numFmt: pesos } }]
      : []),
  ];
  hoja.getRow(1).font = { bold: true };
  for (const f of g.calculo.filas)
    hoja.addRow({
      fecha: fechaHora(f.fecha),
      tipo: f.tipo === "VENTA" ? "Venta" : "Devolución",
      codigo: f.codigo,
      venta: f.ventaCodigo,
      cliente: f.cliente,
      categoria: ETIQUETA_CATEGORIA[f.categoria],
      unidades: f.unidades,
      tarifa: Number(f.tarifa),
      ganancia: Number(f.ganancia),
      ...(conFacturado ? { total: f.tipo === "VENTA" ? Number(f.totalVenta) : null } : {}),
    });
  const slug = g.usuario.nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return {
    buffer: Buffer.from(await libro.xlsx.writeBuffer()),
    nombre: `ganancia-${slug}-${mes}`,
  };
}

const fechaHora = (d: Date) =>
  new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ZONA_DEFAULT,
  }).format(d);
const fechaCorta = (d: Date) =>
  new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: ZONA_DEFAULT }).format(d);
