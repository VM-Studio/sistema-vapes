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
import { puede, type Accion, type SujetoPermisos } from "@/lib/permisos";
import { ahora } from "@/lib/reloj";
import type { FiltrosDeudores } from "@/lib/validations/fiado";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";

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
export async function puedeFiados(
  ctx: CtxFiados,
  accion: Accion,
  db: Tx = dbPara(ctx.panelId),
): Promise<boolean> {
  if (ctx.usuario) return puede(ctx.usuario, ctx.panelId, Modulo.FIADOS, accion);
  const u = await db.usuario.findUnique({
    where: { id: ctx.usuarioId },
    select: {
      rol: true,
      activo: true,
      deletedAt: true,
      permisos: { where: { panelId: ctx.panelId, modulo: Modulo.FIADOS } },
      paneles: { where: { panelId: ctx.panelId }, select: { panelId: true } },
    },
  });
  if (!u || !u.activo || u.deletedAt) return false;
  return puede(
    { rol: u.rol, permisos: u.permisos, paneles: u.paneles.map((p) => p.panelId) },
    ctx.panelId,
    Modulo.FIADOS,
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
// Deudores
// =============================================================================

export interface Deudor {
  id: string;
  nombre: string;
  telefono: string;
  activo: boolean;
  saldo: string;
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
  const grupos = clientes.length
    ? await db.venta.groupBy({
        by: ["clienteId"],
        where: {
          clienteId: { in: clientes.map((c) => c.id) },
          estado: EstadoVenta.CONFIRMADA,
          saldoPendiente: { gt: 0 },
        },
        _count: { _all: true },
        _min: { fecha: true },
      })
    : [];
  const porCliente = new Map(grupos.map((g) => [g.clienteId, g]));
  const hoy = ahora();
  return {
    deudores: clientes.map((c) => {
      const g = porCliente.get(c.id);
      const viejo = g?._min.fecha ?? null;
      return {
        id: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        activo: c.activo,
        saldo: dec(c.saldoDeudor),
        ventasPendientes: g?._count._all ?? 0,
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
  /** Lo pagado en el momento de la venta (pagos no anulados). */
  pagadoAlVender: string;
  /** Lo que quedó debiendo con esta venta (total − pagado al vender). */
  importe: string;
  /** Saldo pendiente HOY de esa venta. */
  saldoVenta: string;
  saldoAcumulado: string;
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
  usuario: string;
  imputaciones: { ventaId: string; codigo: string; monto: string }[];
  anulado: boolean;
  motivoAnulacion: string | null;
  /** Los anulados no mueven el saldo (se repite el anterior). */
  saldoAcumulado: string;
}

export type MovimientoCC = MovimientoVentaCC | MovimientoCobroCC;

export interface VentaPendiente {
  id: string;
  codigo: string;
  fecha: Date;
  total: string;
  montoPagado: string;
  saldoPendiente: string;
  estadoPago: EstadoPago;
  diasAntiguedad: number;
}

export interface CuentaCorriente {
  cliente: { id: string; nombre: string; telefono: string; activo: boolean; saldo: string };
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

  const movimientos: (
    Omit<MovimientoVentaCC, "saldoAcumulado"> | Omit<MovimientoCobroCC, "saldoAcumulado">
  )[] = [];
  const cobros = new Map<string, Omit<MovimientoCobroCC, "saldoAcumulado">>();
  for (const v of ventas) {
    const pagadoAlVender = v.pagos
      .filter((p) => !p.esCobroPosterior && !p.anulado)
      .reduce((a, p) => a.plus(p.monto), CERO);
    movimientos.push({
      tipo: "VENTA",
      fecha: v.fecha,
      ventaId: v.id,
      codigo: v.codigo,
      total: dec(v.total),
      pagadoAlVender: dec(pagadoAlVender),
      importe: dec(v.total.minus(pagadoAlVender)),
      saldoVenta: dec(v.saldoPendiente),
    });
    for (const p of v.pagos.filter((x) => x.esCobroPosterior)) {
      const clave = p.cobroId ?? p.id;
      const existente = cobros.get(clave);
      const imputacion = { ventaId: v.id, codigo: v.codigo, monto: dec(p.monto) };
      if (existente) {
        existente.importe = dec(D(existente.importe).plus(p.monto));
        existente.imputaciones.push(imputacion);
        continue;
      }
      const cobro: Omit<MovimientoCobroCC, "saldoAcumulado"> = {
        tipo: "COBRO",
        fecha: p.fecha,
        pagoId: p.id,
        cobroId: clave,
        medioPago: p.medioPago,
        referencia: p.referencia,
        importe: dec(p.monto),
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
  let saldo = CERO;
  const conSaldo: MovimientoCC[] = movimientos.map((m) => {
    if (m.tipo === "VENTA") saldo = saldo.plus(m.importe);
    else if (!m.anulado) saldo = saldo.minus(m.importe);
    return { ...m, saldoAcumulado: dec(saldo) } as MovimientoCC;
  });

  const hoy = ahora();
  return {
    cliente: {
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      activo: c.activo,
      saldo: dec(c.saldoDeudor),
    },
    movimientos: conSaldo,
    pendientes: ventas
      .filter((v) => v.saldoPendiente.greaterThan(0))
      .map((v) => ({
        id: v.id,
        codigo: v.codigo,
        fecha: v.fecha,
        total: dec(v.total),
        montoPagado: dec(v.montoPagado),
        saldoPendiente: dec(v.saldoPendiente),
        estadoPago: v.estadoPago,
        diasAntiguedad: diasDesde(v.fecha, hoy),
      })),
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
export async function registrarCobro(
  ctx: CtxFiados,
  input: RegistrarCobroInput,
): Promise<CobroRegistrado> {
  const monto = D(input.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (monto.lessThanOrEqualTo(0))
    throw new DomainError("El monto del cobro tiene que ser mayor a 0.");
  const fecha = fechaDelCobro(input.fecha);
  return transaccion(
    ctx,
    async (tx) => {
      await exigirFiados(ctx, "editar", "No tenés permiso para registrar cobros.", tx);
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

export interface ResumenFiados {
  /** Σ saldo deudor actual de todos los clientes. */
  porCobrar: string;
  deudores: number;
  /** Lo que quedó debiendo en las ventas del período (total − pagado al vender). */
  fiadoPeriodo: string;
  /** Cobros de cuenta corriente del período (no anulados). */
  cobradoPeriodo: string;
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
  const [deuda, [fiado], cobrado] = await Promise.all([
    db.cliente.aggregate({
      where: { saldoDeudor: { gt: 0 } },
      _sum: { saldoDeudor: true },
      _count: { _all: true },
    }),
    db.$queryRaw<{ fiado: string }[]>`
      SELECT COALESCE(SUM(v."total" - COALESCE(p."pagado", 0)), 0)::text AS "fiado"
      FROM "Venta" v
      LEFT JOIN (
        SELECT "ventaId", SUM("monto") AS "pagado" FROM "PagoVenta"
        WHERE "panelId" = ${ctx.panelId} AND NOT "anulado" AND NOT "esCobroPosterior"
        GROUP BY "ventaId"
      ) p ON p."ventaId" = v."id"
      WHERE v."panelId" = ${ctx.panelId} AND v."estado" = 'CONFIRMADA'
        AND v."fecha" >= ${ts(periodo.desde)} AND v."fecha" < ${ts(periodo.hasta)}`,
    db.pagoVenta.aggregate({
      where: {
        esCobroPosterior: true,
        anulado: false,
        fecha: { gte: periodo.desde, lt: periodo.hasta },
      },
      _sum: { monto: true },
    }),
  ]);
  return {
    porCobrar: dec(deuda._sum.saldoDeudor ?? CERO),
    deudores: deuda._count._all,
    fiadoPeriodo: dec(D(fiado?.fiado ?? "0")),
    cobradoPeriodo: dec(cobrado._sum.monto ?? CERO),
  };
}
