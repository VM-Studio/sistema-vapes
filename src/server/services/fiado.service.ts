import { randomUUID } from "node:crypto";

import {
  AccionAuditoria,
  EstadoPago,
  EstadoVenta,
  MedioPago,
  Modulo,
  Prisma,
  RolUsuario,
} from "@prisma/client";

import { hoyAR } from "@/lib/fechas";
import { listaDeMedios } from "@/lib/medios-pago";
import { MONTOS_CERO, type Montos } from "@/lib/moneda";
import { puede, type Accion, type SujetoPermisos } from "@/lib/permisos";
import { ahora } from "@/lib/reloj";
import type { FiltrosDeudores } from "@/lib/validations/fiado";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import { enDolares, sumar } from "@/server/moneda/montos-venta";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";

/**
 * FIADOS — cuenta corriente de clientes (por panel).
 *
 * - Una venta es "fiada" cuando lo pagado al vender no cubre el total: queda
 *   PARCIAL (pagó algo) o PENDIENTE (no pagó nada) con `saldoPendiente`, y el
 *   cliente suma ese saldo en `saldoDeudor` (caché de Σ saldoPendiente de sus
 *   ventas confirmadas, que un trigger diferido verifica al COMMIT).
 * - Un cobro se imputa de la venta más vieja a la más nueva (o solo a las
 *   elegidas): un PagoVenta `esCobroPosterior` por venta tocada, todos con el
 *   mismo `cobroId`. Los pagos no se editan: se anulan (solo dueños).
 * - Toda operación que cambia saldos bloquea PRIMERO la fila del cliente
 *   (FOR UPDATE) y después toca sus ventas: mismo orden en ventas fiadas,
 *   cobros y anulaciones, sin deadlocks entre ellas.
 * - Permisos de FIADOS: ver = deudas y cuenta corriente · crear = vender fiado
 *   · editar = registrar cobros · anular cobros = solo dueños.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const CERO = D(0);
const dec = (d: Prisma.Decimal) => d.toFixed(2);
const DIA_MS = 24 * 3600 * 1000;

/** ctx de las acciones/páginas (trae el usuario) o de un script (se consulta). */
export type CtxFiados = Ctx & { usuario?: SujetoPermisos };

/**
 * ¿Puede `accion` en FIADOS en el panel del ctx? Con el usuario del request
 * (CtxPanel) se decide en memoria; si no, se leen su rol y permisos de la DB
 * (dentro de la transacción que llama, si la hay).
 */
export function puedeFiados(
  ctx: CtxFiados,
  accion: Accion,
  db: Tx = dbPara(ctx.panelId),
): Promise<boolean> {
  return puedeEnModulo(ctx, Modulo.FIADOS, accion, db);
}

/** Igual que puedeFiados, para cualquier módulo del panel. */
export async function puedeEnModulo(
  ctx: CtxFiados,
  modulo: Modulo,
  accion: Accion,
  db: Tx = dbPara(ctx.panelId),
): Promise<boolean> {
  if (ctx.usuario) return puede(ctx.usuario, ctx.panelId, modulo, accion);
  const u = await db.usuario.findUnique({
    where: { id: ctx.usuarioId },
    select: {
      rol: true,
      activo: true,
      deletedAt: true,
      permisos: { where: { panelId: ctx.panelId, modulo } },
      paneles: { where: { panelId: ctx.panelId }, select: { panelId: true } },
    },
  });
  if (!u || !u.activo || u.deletedAt) return false;
  return puede(
    { rol: u.rol, permisos: u.permisos, paneles: u.paneles.map((p) => p.panelId) },
    ctx.panelId,
    modulo,
    accion,
  );
}

async function exigirFiados(ctx: CtxFiados, accion: Accion, mensaje: string, db?: Tx) {
  if (!(await puedeFiados(ctx, accion, db))) throw new ForbiddenError(mensaje);
}

/** Estado de pago coherente con los montos (el mismo que exige el CHECK de la DB). */
export function estadoPagoDe(montoPagado: Prisma.Decimal, saldoPendiente: Prisma.Decimal) {
  if (saldoPendiente.lessThanOrEqualTo(0)) return EstadoPago.PAGADA;
  return montoPagado.greaterThan(0) ? EstadoPago.PARCIAL : EstadoPago.PENDIENTE;
}

/** Bloquea la fila del cliente (siempre lo primero en una operación de cuenta corriente). */
export async function bloquearCliente(tx: Tx, ctx: Ctx, clienteId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "Cliente" WHERE "id" = ${clienteId} AND "panelId" = ${ctx.panelId} FOR UPDATE
  `;
}

const diasDesde = (fecha: Date, hoy: Date) =>
  Math.max(0, Math.floor((hoy.getTime() - fecha.getTime()) / DIA_MS));

// =============================================================================
// Montos en USDT (moneda principal, ver src/lib/moneda.ts)
// =============================================================================
// La deuda es en pesos (precios y cobros en pesos), pero se MUESTRA en USDT:
// cada peso adeudado / cobrado se convierte con la cotización de SU venta
// (USDT = ROUND(pesos ÷ venta.tipoCambioUsdt, 2), dólares igual con el blue)
// y después se suma. Nunca se divide una suma en pesos por la cotización de hoy.

/** Cotizaciones congeladas de una venta. */
interface CotizacionVenta {
  tipoCambioUsdt: Prisma.Decimal;
  tipoCambioUsd: Prisma.Decimal;
}

const aUsdt = (pesos: Prisma.Decimal, v: CotizacionVenta) =>
  pesos.div(v.tipoCambioUsdt).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Un monto en pesos de una venta (saldo, pago, …) en las tres monedas, a la cotización de la venta. */
export function montosDePesosDeVenta(pesos: Prisma.Decimal, v: CotizacionVenta): Montos {
  return {
    usdt: aUsdt(pesos, v).toFixed(2),
    pesos: pesos.toFixed(2),
    usd: enDolares(pesos, v.tipoCambioUsd).toFixed(2),
  };
}

/** Fila SQL con un monto en las tres monedas (sumas ya convertidas venta por venta). */
interface FilaMontos {
  usdt: string;
  pesos: string;
  usd: string;
}

const montosDeFila = (f: FilaMontos | undefined): Montos =>
  f ? { usdt: dec(D(f.usdt)), pesos: dec(D(f.pesos)), usd: dec(D(f.usd)) } : MONTOS_CERO;

/** SUM en las tres monedas de un monto en pesos de la venta `v` (cada fila a su cotización). */
const sqlSumaMontos = (pesos: Prisma.Sql) => Prisma.sql`
  COALESCE(SUM(ROUND(${pesos} / v."tipoCambioUsdt", 2)), 0)::text AS "usdt",
  COALESCE(SUM(${pesos}), 0)::text AS "pesos",
  COALESCE(SUM(ROUND(${pesos} / v."tipoCambioUsd", 2)), 0)::text AS "usd"`;

export interface DeudaCliente {
  deuda: Montos;
  ventasPendientes: number;
  /** Fecha de la venta pendiente más vieja. */
  fiadoMasViejo: Date | null;
}

/**
 * Deuda de cada cliente en las tres monedas: Σ saldoPendiente de sus ventas
 * confirmadas, cada una convertida a la cotización de SU venta (en pesos
 * coincide con Cliente.saldoDeudor). Los clientes sin deuda no vienen.
 */
export async function deudaDeClientes(
  ctx: Ctx,
  clienteIds: readonly string[],
): Promise<Map<string, DeudaCliente>> {
  if (clienteIds.length === 0) return new Map();
  const filas = await dbPara(ctx.panelId).$queryRaw<
    (FilaMontos & { clienteId: string; ventas: number; masVieja: Date })[]
  >`
    SELECT v."clienteId", ${sqlSumaMontos(Prisma.sql`v."saldoPendiente"`)},
      COUNT(*)::int AS "ventas", MIN(v."fecha") AS "masVieja"
    FROM "Venta" v
    WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
      AND v."saldoPendiente" > 0 AND v."clienteId" IN (${Prisma.join([...clienteIds])})
    GROUP BY v."clienteId"`;
  return new Map(
    filas.map((f) => [
      f.clienteId,
      { deuda: montosDeFila(f), ventasPendientes: f.ventas, fiadoMasViejo: f.masVieja },
    ]),
  );
}

// =============================================================================
// Deudores
// =============================================================================

export interface Deudor {
  id: string;
  nombre: string;
  telefono: string;
  activo: boolean;
  /** Deuda en pesos (= Cliente.saldoDeudor). */
  saldo: string;
  /** La deuda en USDT (principal), pesos y dólares, cada venta a su cotización. */
  deuda: Montos;
  ventasPendientes: number;
  /** Fecha de la venta pendiente más vieja. */
  fiadoMasViejo: Date | null;
  diasAntiguedad: number | null;
}

export const PAGE_SIZE_DEUDORES = 30;

/** Clientes con saldo deudor, de mayor a menor deuda (búsqueda por nombre o teléfono). */
export async function deudores(
  ctx: Ctx,
  f: FiltrosDeudores,
): Promise<{ deudores: Deudor[]; total: number; page: number; pageSize: number }> {
  const db = dbPara(ctx.panelId);
  const q = f.q?.trim();
  const digitos = q?.replace(/\D/g, "") ?? "";
  const where: Prisma.ClienteWhereInput = {
    saldoDeudor: { gt: 0 },
    ...(q
      ? {
          OR: [
            { nombre: { contains: q, mode: "insensitive" } },
            ...(digitos.length >= 3 ? [{ telefono: { contains: digitos } }] : []),
          ],
        }
      : {}),
  };
  const [total, clientes] = await Promise.all([
    db.cliente.count({ where }),
    db.cliente.findMany({
      where,
      orderBy: [{ saldoDeudor: "desc" }, { nombre: "asc" }],
      skip: (f.page - 1) * PAGE_SIZE_DEUDORES,
      take: PAGE_SIZE_DEUDORES,
      select: { id: true, nombre: true, telefono: true, activo: true, saldoDeudor: true },
    }),
  ]);
  const porCliente = await deudaDeClientes(
    ctx,
    clientes.map((c) => c.id),
  );
  const hoy = ahora();
  return {
    deudores: clientes.map((c) => {
      const g = porCliente.get(c.id);
      const viejo = g?.fiadoMasViejo ?? null;
      return {
        id: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        activo: c.activo,
        saldo: dec(c.saldoDeudor),
        deuda: g?.deuda ?? MONTOS_CERO,
        ventasPendientes: g?.ventasPendientes ?? 0,
        fiadoMasViejo: viejo,
        diasAntiguedad: viejo ? diasDesde(viejo, hoy) : null,
      };
    }),
    total,
    page: f.page,
    pageSize: PAGE_SIZE_DEUDORES,
  };
}

// =============================================================================
// Cuenta corriente
// =============================================================================

export interface MovimientoVentaCC {
  tipo: "VENTA";
  fecha: Date;
  ventaId: string;
  codigo: string;
  total: string;
  /** Total de la venta en las tres monedas (USDT congelado de la venta). */
  totalMontos: Montos;
  /** Lo pagado en el momento de la venta (pagos no anulados). */
  pagadoAlVender: string;
  /** Lo que quedó debiendo con esta venta (total − pagado al vender). */
  importe: string;
  /** `importe` en las tres monedas (a la cotización de la venta). */
  montos: Montos;
  /** Saldo pendiente HOY de esa venta. */
  saldoVenta: string;
  saldoAcumulado: string;
  /** Saldo acumulado en las tres monedas (cada venta a su cotización). */
  saldoMontos: Montos;
}

export interface MovimientoCobroCC {
  tipo: "COBRO";
  fecha: Date;
  /** Id de uno de los pagos del cobro (para anularlo). */
  pagoId: string;
  cobroId: string;
  medioPago: MedioPago;
  referencia: string | null;
  importe: string;
  /** `importe` en las tres monedas: cada imputación a la cotización de su venta. */
  montos: Montos;
  usuario: string;
  imputaciones: { ventaId: string; codigo: string; monto: string; montos: Montos }[];
  anulado: boolean;
  motivoAnulacion: string | null;
  /** Los anulados no mueven el saldo (se repite el anterior). */
  saldoAcumulado: string;
  saldoMontos: Montos;
}

export type MovimientoCC = MovimientoVentaCC | MovimientoCobroCC;

export interface VentaPendiente {
  id: string;
  codigo: string;
  fecha: Date;
  total: string;
  montoPagado: string;
  saldoPendiente: string;
  /** `saldoPendiente` en las tres monedas (a la cotización de la venta). */
  saldoMontos: Montos;
  /** Total de la venta en las tres monedas. */
  totalMontos: Montos;
  estadoPago: EstadoPago;
  diasAntiguedad: number;
}

export interface CuentaCorriente {
  cliente: {
    id: string;
    nombre: string;
    telefono: string;
    activo: boolean;
    /** Deuda en pesos (= Cliente.saldoDeudor): lo que se cobra. */
    saldo: string;
    /** La deuda en USDT (principal), pesos y dólares, cada venta a su cotización. */
    deuda: Montos;
  };
  movimientos: MovimientoCC[];
  pendientes: VentaPendiente[];
}

const MAX_VENTAS_CC = 500;

/**
 * Cuenta corriente de un cliente: ventas fiadas y cobros en orden de fecha,
 * con saldo acumulado (el último coincide con `saldoDeudor`), y las ventas
 * que todavía deben, de la más vieja a la más nueva.
 */
export async function cuentaCorriente(ctx: Ctx, clienteId: string): Promise<CuentaCorriente> {
  const db = dbPara(ctx.panelId);
  const c = await db.cliente.findUnique({
    where: { id: clienteId },
    select: { id: true, nombre: true, telefono: true, activo: true, saldoDeudor: true },
  });
  if (!c) throw new NotFoundError("El cliente no existe");

  // Ventas que alguna vez quedaron debiendo: las que hoy deben y las saldadas con cobros.
  const ventas = await db.venta.findMany({
    where: {
      clienteId,
      estado: EstadoVenta.CONFIRMADA,
      OR: [
        { estadoPago: { not: EstadoPago.PAGADA } },
        { pagos: { some: { esCobroPosterior: true } } },
      ],
    },
    orderBy: [{ fecha: "asc" }, { numero: "asc" }],
    take: MAX_VENTAS_CC,
    select: {
      id: true,
      codigo: true,
      fecha: true,
      total: true,
      totalUsdt: true,
      tipoCambioUsdt: true,
      tipoCambioUsd: true,
      montoPagado: true,
      saldoPendiente: true,
      estadoPago: true,
      pagos: {
        orderBy: [{ fecha: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          medioPago: true,
          monto: true,
          referencia: true,
          esCobroPosterior: true,
          cobroId: true,
          fecha: true,
          anulado: true,
          motivoAnulacion: true,
          usuario: { select: { nombre: true } },
        },
      },
    },
  });

  type SinSaldo<T> = Omit<T, "saldoAcumulado" | "saldoMontos">;
  const movimientos: (SinSaldo<MovimientoVentaCC> | SinSaldo<MovimientoCobroCC>)[] = [];
  const cobros = new Map<string, SinSaldo<MovimientoCobroCC>>();
  const cotizacion = new Map<string, CotizacionVenta>();
  for (const v of ventas) {
    cotizacion.set(v.id, v);
    const pagadoAlVender = v.pagos
      .filter((p) => !p.esCobroPosterior && !p.anulado)
      .reduce((a, p) => a.plus(p.monto), CERO);
    const importe = v.total.minus(pagadoAlVender);
    movimientos.push({
      tipo: "VENTA",
      fecha: v.fecha,
      ventaId: v.id,
      codigo: v.codigo,
      total: dec(v.total),
      totalMontos: { ...montosDePesosDeVenta(v.total, v), usdt: dec(v.totalUsdt) },
      pagadoAlVender: dec(pagadoAlVender),
      importe: dec(importe),
      montos: montosDePesosDeVenta(importe, v),
      saldoVenta: dec(v.saldoPendiente),
    });
    for (const p of v.pagos.filter((x) => x.esCobroPosterior)) {
      const clave = p.cobroId ?? p.id;
      const existente = cobros.get(clave);
      const imputacion = {
        ventaId: v.id,
        codigo: v.codigo,
        monto: dec(p.monto),
        montos: montosDePesosDeVenta(p.monto, v),
      };
      if (existente) {
        existente.importe = dec(D(existente.importe).plus(p.monto));
        existente.montos = sumar([existente.montos, imputacion.montos]);
        existente.imputaciones.push(imputacion);
        continue;
      }
      const cobro: SinSaldo<MovimientoCobroCC> = {
        tipo: "COBRO",
        fecha: p.fecha,
        pagoId: p.id,
        cobroId: clave,
        medioPago: p.medioPago,
        referencia: p.referencia,
        importe: dec(p.monto),
        montos: imputacion.montos,
        usuario: p.usuario.nombre,
        imputaciones: [imputacion],
        anulado: p.anulado,
        motivoAnulacion: p.motivoAnulacion,
      };
      cobros.set(clave, cobro);
      movimientos.push(cobro);
    }
  }
  // Por fecha; a igual fecha, la venta antes que su cobro.
  movimientos.sort(
    (a, b) =>
      a.fecha.getTime() - b.fecha.getTime() ||
      (a.tipo === b.tipo ? 0 : a.tipo === "VENTA" ? -1 : 1),
  );
  // Saldo en USDT/dólares = Σ (saldo en pesos de cada venta → a SU cotización):
  // se lleva el saldo en pesos por venta y, al moverse una, se reemplaza su
  // aporte convertido. El último coincide con la deuda (Σ saldoPendiente convertido).
  let saldo = CERO;
  let saldoUsdt = CERO;
  let saldoUsd = CERO;
  const saldoPorVenta = new Map<string, Prisma.Decimal>();
  const mover = (ventaId: string, delta: Prisma.Decimal) => {
    const v = cotizacion.get(ventaId)!;
    const antes = saldoPorVenta.get(ventaId) ?? CERO;
    const despues = antes.plus(delta);
    saldoPorVenta.set(ventaId, despues);
    saldo = saldo.plus(delta);
    saldoUsdt = saldoUsdt.minus(aUsdt(antes, v)).plus(aUsdt(despues, v));
    saldoUsd = saldoUsd
      .minus(enDolares(antes, v.tipoCambioUsd))
      .plus(enDolares(despues, v.tipoCambioUsd));
  };
  const conSaldo: MovimientoCC[] = movimientos.map((m) => {
    if (m.tipo === "VENTA") mover(m.ventaId, D(m.importe));
    else if (!m.anulado) for (const i of m.imputaciones) mover(i.ventaId, D(i.monto).neg());
    return {
      ...m,
      saldoAcumulado: dec(saldo),
      saldoMontos: { usdt: dec(saldoUsdt), pesos: dec(saldo), usd: dec(saldoUsd) },
    } as MovimientoCC;
  });

  const hoy = ahora();
  const pendientes: VentaPendiente[] = ventas
    .filter((v) => v.saldoPendiente.greaterThan(0))
    .map((v) => ({
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      total: dec(v.total),
      montoPagado: dec(v.montoPagado),
      saldoPendiente: dec(v.saldoPendiente),
      saldoMontos: montosDePesosDeVenta(v.saldoPendiente, v),
      totalMontos: { ...montosDePesosDeVenta(v.total, v), usdt: dec(v.totalUsdt) },
      estadoPago: v.estadoPago,
      diasAntiguedad: diasDesde(v.fecha, hoy),
    }));
  return {
    cliente: {
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      activo: c.activo,
      saldo: dec(c.saldoDeudor),
      deuda: pendientes.length ? sumar(pendientes.map((v) => v.saldoMontos)) : MONTOS_CERO,
    },
    movimientos: conSaldo,
    pendientes,
  };
}

// =============================================================================
// Cobros
// =============================================================================

export interface CobroRegistrado {
  cobroId: string;
  cliente: { id: string; nombre: string; telefono: string };
  monto: string;
  medioPago: MedioPago;
  referencia: string | null;
  fecha: Date;
  imputaciones: {
    ventaId: string;
    codigo: string;
    monto: string;
    saldoVenta: string;
    estadoPago: EstadoPago;
  }[];
  /** Deuda del cliente después del cobro. */
  saldoRestante: string;
}

/** Datos de un cobro (validados con registrarCobroSchema en la acción). */
export interface RegistrarCobroInput {
  clienteId: string;
  monto: number;
  medioPago: MedioPago;
  referencia?: string;
  /** YYYY-MM-DD (hora argentina); vacío = ahora. */
  fecha?: string;
  /** Solo estas ventas; vacío = todas las pendientes, de la más vieja a la más nueva. */
  ventaIds?: string[];
}

/** Día elegido del cobro: hoy = ahora; un día anterior = a las 12 hs de ese día (hora argentina). */
function fechaDelCobro(fecha: string | undefined): Date {
  const instante = ahora();
  if (!fecha || fecha === hoyAR(instante)) return instante;
  if (fecha > hoyAR(instante)) throw new DomainError("La fecha del cobro no puede ser futura.");
  return new Date(`${fecha}T12:00:00.000-03:00`);
}

/**
 * Registra un cobro de cuenta corriente: lo imputa a las ventas pendientes de
 * la más vieja a la más nueva (o solo a `ventaIds`), un PagoVenta por venta
 * tocada (el último puede ser parcial), y baja el saldo del cliente. El monto
 * no puede superar la deuda. Todo en una transacción Serializable.
 */
export function registrarCobro(
  ctx: CtxFiados,
  input: RegistrarCobroInput,
): Promise<CobroRegistrado> {
  return cobrar(ctx, input, (tx) =>
    exigirFiados(ctx, "editar", "No tenés permiso para registrar cobros.", tx),
  );
}

/**
 * «Marcar pagada» desde una venta (detalle o listado de Ventas): un cobro de
 * cuenta corriente imputado SOLO a esa venta (total o parcial), con la misma
 * mecánica que registrarCobro (PagoVenta esCobroPosterior, saldo del cliente,
 * auditoría «Cobro»). Alcanza con VENTAS "editar" o FIADOS "editar".
 */
export async function cobrarVenta(
  ctx: CtxFiados,
  ventaId: string,
  input: { monto: number; medioPago: MedioPago; referencia?: string },
): Promise<CobroRegistrado> {
  const venta = await dbPara(ctx.panelId).venta.findUnique({
    where: { id: ventaId },
    select: { clienteId: true, codigo: true, estado: true, saldoPendiente: true },
  });
  if (!venta) throw new NotFoundError("La venta no existe.");
  if (venta.estado !== EstadoVenta.CONFIRMADA)
    throw new DomainError(`La venta ${venta.codigo} está anulada.`);
  if (venta.saldoPendiente.lessThanOrEqualTo(0))
    throw new DomainError(`La venta ${venta.codigo} ya está pagada.`);
  return cobrar(ctx, { clienteId: venta.clienteId, ventaIds: [ventaId], ...input }, async (tx) => {
    const ok =
      (await puedeEnModulo(ctx, Modulo.VENTAS, "editar", tx)) ||
      (await puedeEnModulo(ctx, Modulo.FIADOS, "editar", tx));
    if (!ok) throw new ForbiddenError("No tenés permiso para marcar ventas como pagadas.");
  });
}

async function cobrar(
  ctx: CtxFiados,
  input: RegistrarCobroInput,
  exigirPermiso: (tx: Tx) => Promise<void>,
): Promise<CobroRegistrado> {
  const monto = D(input.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (monto.lessThanOrEqualTo(0))
    throw new DomainError("El monto del cobro tiene que ser mayor a 0.");
  const fecha = fechaDelCobro(input.fecha);
  return transaccion(
    ctx,
    async (tx) => {
      await exigirPermiso(tx);
      const { mediosPago } = await obtenerConfigVentas(ctx, tx);
      if (!mediosPago.includes(input.medioPago))
        throw new DomainError(
          `Elegí el medio del cobro: ${listaDeMedios(mediosPago, ETIQUETA_MEDIO_PAGO)}.`,
        );
      await bloquearCliente(tx, ctx, input.clienteId);
      const cliente = await tx.cliente.findUnique({
        where: { id: input.clienteId },
        select: { id: true, nombre: true, telefono: true, saldoDeudor: true },
      });
      if (!cliente) throw new NotFoundError("El cliente no existe");
      if (cliente.saldoDeudor.lessThanOrEqualTo(0))
        throw new DomainError(`${cliente.nombre} no tiene deuda pendiente.`);
      if (monto.greaterThan(cliente.saldoDeudor)) {
        throw new DomainError(
          `El cobro (${dec(monto)}) supera la deuda de ${cliente.nombre} (${dec(cliente.saldoDeudor)}).`,
          "VALIDATION_ERROR",
          400,
          { monto: [`Máximo ${dec(cliente.saldoDeudor)}`] },
        );
      }

      const pendientes = await tx.venta.findMany({
        where: {
          clienteId: cliente.id,
          estado: EstadoVenta.CONFIRMADA,
          saldoPendiente: { gt: 0 },
          ...(input.ventaIds?.length ? { id: { in: input.ventaIds } } : {}),
        },
        orderBy: [{ fecha: "asc" }, { numero: "asc" }],
        select: {
          id: true,
          codigo: true,
          fecha: true,
          montoPagado: true,
          saldoPendiente: true,
          estadoPago: true,
        },
      });
      if (input.ventaIds?.length && pendientes.length !== input.ventaIds.length)
        throw new DomainError("Alguna de las ventas elegidas no existe o ya está saldada.");
      const deudaElegida = pendientes.reduce((a, v) => a.plus(v.saldoPendiente), CERO);
      if (monto.greaterThan(deudaElegida)) {
        throw new DomainError(
          `El cobro (${dec(monto)}) supera el saldo de las ventas elegidas (${dec(deudaElegida)}).`,
          "VALIDATION_ERROR",
          400,
          { monto: [`Máximo ${dec(deudaElegida)}`] },
        );
      }

      const cobroId = `cob_${randomUUID()}`;
      const imputaciones: CobroRegistrado["imputaciones"] = [];
      let restante = monto;
      for (const v of pendientes) {
        if (restante.lessThanOrEqualTo(0)) break;
        if (fecha < v.fecha)
          throw new DomainError(`La fecha del cobro es anterior a la venta ${v.codigo}.`);
        const aplicado = Prisma.Decimal.min(restante, v.saldoPendiente);
        const montoPagado = v.montoPagado.plus(aplicado);
        const saldoPendiente = v.saldoPendiente.minus(aplicado);
        const estadoPago = estadoPagoDe(montoPagado, saldoPendiente);
        await tx.pagoVenta.create({
          data: {
            ventaId: v.id,
            medioPago: input.medioPago,
            monto: aplicado,
            referencia: input.referencia ?? null,
            esCobroPosterior: true,
            cobroId,
            fecha,
            usuarioId: ctx.usuarioId,
          },
        });
        await tx.venta.update({
          where: { id: v.id },
          data: { montoPagado, saldoPendiente, estadoPago },
        });
        imputaciones.push({
          ventaId: v.id,
          codigo: v.codigo,
          monto: dec(aplicado),
          saldoVenta: dec(saldoPendiente),
          estadoPago,
        });
        restante = restante.minus(aplicado);
      }

      const saldoRestante = cliente.saldoDeudor.minus(monto);
      await tx.cliente.update({
        where: { id: cliente.id },
        data: { saldoDeudor: saldoRestante },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Cobro",
        entidadId: cobroId,
        datosAntes: { clienteId: cliente.id, saldoDeudor: dec(cliente.saldoDeudor) },
        datosDespues: {
          clienteId: cliente.id,
          monto: dec(monto),
          medioPago: input.medioPago,
          referencia: input.referencia ?? null,
          fecha: fecha.toISOString(),
          saldoDeudor: dec(saldoRestante),
          imputaciones: imputaciones.map((i) => ({
            ventaId: i.ventaId,
            codigo: i.codigo,
            monto: i.monto,
          })),
        },
        meta: ctx.meta,
      });
      return {
        cobroId,
        cliente: { id: cliente.id, nombre: cliente.nombre, telefono: cliente.telefono },
        monto: dec(monto),
        medioPago: input.medioPago,
        referencia: input.referencia ?? null,
        fecha,
        imputaciones,
        saldoRestante: dec(saldoRestante),
      };
    },
    { maxRetries: 30, timeout: 30_000 },
  );
}

/**
 * Anula un cobro (solo dueños): todos los PagoVenta del mismo cobro quedan
 * anulados y sus montos vuelven a deberse (venta y cliente). Los pagos hechos
 * al vender no se anulan acá: se anula la venta.
 */
export async function anularCobro(
  ctx: Ctx,
  pagoId: string,
  motivo: string,
): Promise<{ cobroId: string; clienteId: string; monto: string }> {
  const m = motivo.trim();
  if (!m) throw new DomainError("Contá por qué se anula el cobro.");
  return transaccion(
    ctx,
    async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { id: ctx.usuarioId },
        select: { rol: true },
      });
      if (usuario?.rol !== RolUsuario.OWNER)
        throw new ForbiddenError("Solo un dueño puede anular cobros.");
      const pago = await tx.pagoVenta.findUnique({
        where: { id: pagoId },
        select: {
          id: true,
          cobroId: true,
          esCobroPosterior: true,
          venta: { select: { clienteId: true } },
        },
      });
      if (!pago) throw new NotFoundError("El cobro no existe");
      if (!pago.esCobroPosterior)
        throw new DomainError("Los pagos hechos al vender no se anulan solos: anulá la venta.");
      const clienteId = pago.venta.clienteId;
      await bloquearCliente(tx, ctx, clienteId);

      const pagos = await tx.pagoVenta.findMany({
        where: pago.cobroId ? { cobroId: pago.cobroId } : { id: pago.id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          monto: true,
          anulado: true,
          ventaId: true,
          venta: {
            select: { codigo: true, estado: true, montoPagado: true, saldoPendiente: true },
          },
        },
      });
      const vigentes = pagos.filter((p) => !p.anulado);
      if (vigentes.length === 0) throw new DomainError("El cobro ya está anulado.");
      const enAnulada = vigentes.find((p) => p.venta.estado !== EstadoVenta.CONFIRMADA);
      if (enAnulada)
        throw new DomainError(
          `La venta ${enAnulada.venta.codigo} está anulada: su cobro ya no cuenta.`,
        );

      const cuando = ahora();
      let total = CERO;
      for (const p of vigentes) {
        await tx.$queryRaw`
          SELECT "id" FROM "Venta" WHERE "id" = ${p.ventaId} AND "panelId" = ${ctx.panelId} FOR UPDATE
        `;
        const v = await tx.venta.findUniqueOrThrow({
          where: { id: p.ventaId },
          select: { montoPagado: true, saldoPendiente: true },
        });
        const montoPagado = v.montoPagado.minus(p.monto);
        const saldoPendiente = v.saldoPendiente.plus(p.monto);
        await tx.pagoVenta.update({
          where: { id: p.id },
          data: {
            anulado: true,
            anuladoPorId: ctx.usuarioId,
            anuladoAt: cuando,
            motivoAnulacion: m,
          },
        });
        await tx.venta.update({
          where: { id: p.ventaId },
          data: {
            montoPagado,
            saldoPendiente,
            estadoPago: estadoPagoDe(montoPagado, saldoPendiente),
          },
        });
        total = total.plus(p.monto);
      }
      const cliente = await tx.cliente.update({
        where: { id: clienteId },
        data: { saldoDeudor: { increment: total } },
        select: { saldoDeudor: true },
      });
      const cobroId = pago.cobroId ?? pago.id;
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Cobro",
        entidadId: cobroId,
        datosAntes: { anulado: false },
        datosDespues: {
          anulado: true,
          motivo: m,
          clienteId,
          monto: dec(total),
          pagos: vigentes.map((p) => p.id),
          saldoDeudor: dec(cliente.saldoDeudor),
        },
        meta: ctx.meta,
      });
      return { cobroId, clienteId, monto: dec(total) };
    },
    { maxRetries: 10, timeout: 30_000 },
  );
}

// =============================================================================
// Resumen (dashboard y módulo Fiados)
// =============================================================================

/**
 * Montos en USDT (principal), pesos y dólares; cada peso convertido a la
 * cotización de SU venta y después sumado.
 */
export interface ResumenFiados {
  /** Σ saldo deudor actual de todos los clientes (Σ saldoPendiente de ventas confirmadas). */
  porCobrar: Montos;
  deudores: number;
  /** Lo que quedó debiendo en las ventas del período (total − pagado al vender). */
  fiadoPeriodo: Montos;
  /** Cobros de cuenta corriente del período (no anulados). */
  cobradoPeriodo: Montos;
}

/**
 * `fecha` es timestamp SIN zona (UTC): el instante se pasa como texto ISO para
 * que Postgres no lo corra con la zona de la sesión.
 */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Resumen de cuenta corriente: deuda actual y lo fiado/cobrado en [desde, hasta). */
export async function resumenFiados(
  ctx: Ctx,
  periodo: { desde: Date; hasta: Date },
): Promise<ResumenFiados> {
  const db = dbPara(ctx.panelId);
  const [cantidadDeudores, [deuda], [fiado], [cobrado]] = await Promise.all([
    db.cliente.count({ where: { saldoDeudor: { gt: 0 } } }),
    db.$queryRaw<FilaMontos[]>`
      SELECT ${sqlSumaMontos(Prisma.sql`v."saldoPendiente"`)}
      FROM "Venta" v
      WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
        AND v."saldoPendiente" > 0`,
    db.$queryRaw<FilaMontos[]>`
      SELECT ${sqlSumaMontos(Prisma.sql`(v."total" - COALESCE(p."pagado", 0))`)}
      FROM "Venta" v
      LEFT JOIN (
        SELECT "ventaId", SUM("monto") AS "pagado" FROM "PagoVenta"
        WHERE "panelId" = ${ctx.panelId} AND NOT "anulado" AND NOT "esCobroPosterior"
        GROUP BY "ventaId"
      ) p ON p."ventaId" = v."id"
      WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
        AND v."fecha" >= ${ts(periodo.desde)} AND v."fecha" < ${ts(periodo.hasta)}`,
    db.$queryRaw<FilaMontos[]>`
      SELECT ${sqlSumaMontos(Prisma.sql`pv."monto"`)}
      FROM "PagoVenta" pv
      JOIN "Venta" v ON v."id" = pv."ventaId"
      WHERE pv."panelId" = ${ctx.panelId} AND pv."esCobroPosterior" AND NOT pv."anulado"
        AND pv."fecha" >= ${ts(periodo.desde)} AND pv."fecha" < ${ts(periodo.hasta)}`,
  ]);
  return {
    porCobrar: montosDeFila(deuda),
    deudores: cantidadDeudores,
    fiadoPeriodo: montosDeFila(fiado),
    cobradoPeriodo: montosDeFila(cobrado),
  };
}
