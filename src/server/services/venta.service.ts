import {
  AccionAuditoria,
  EstadoPago,
  EstadoVenta,
  MedioPago,
  Prisma,
  TipoMovimiento,
  type TipoComprobante,
} from "@prisma/client";

import { finDelDia, inicioDelDia } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { prisma, withTransaction, type Tx } from "@/lib/db";
import type {
  BorradorVenta,
  Devolucion as DevolucionInput,
  FiltrosVentas,
  PagoACuenta,
  PagoInput,
  RedondeoVenta,
} from "@/lib/validations/venta";
import { ahora } from "@/lib/reloj";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";
import {
  cajaParaEfectivo,
  registrarMovimientoCaja,
  verificarEfectivoDisponible,
} from "@/server/services/caja.service";
import {
  anularComprobanteDeVenta,
  emitirComprobante,
  ETIQUETA_MEDIO_PAGO,
  obtenerPdfComprobante,
} from "@/server/services/comprobante.service";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";
import { nombreCompleto } from "@/server/services/producto.service";
import { recalcularResumenes } from "@/server/services/resumen-diario.service";
import { registrarMovimiento } from "@/server/services/stock.service";

/**
 * VENTAS
 * - Precios, costos y totales se calculan SIEMPRE acá. El cliente manda ids,
 *   cantidades y montos de pago.
 * - Confirmar: una transacción Serializable (con reintentos) que descuenta
 *   stock (VENTA por ítem), congela el costo, registra los pagos, actualiza la
 *   cuenta corriente y numera el comprobante. Todo o nada.
 * - Orden de bloqueo, en todas las operaciones: cliente → venta → stock (por
 *   variante). Así un pago a cuenta y un cobro de la misma venta no se cruzan.
 * - La DB verifica al COMMIT: montoPagado = Σ pagos vigentes,
 *   montoPagado + saldoPendiente = total, saldoDeudor = Σ saldos pendientes,
 *   devoluciones = Σ ítems y cantidadDevuelta = Σ devuelto ≤ vendido.
 * - Caja: el efectivo que entra o sale (cobro, devolución, anulación) se
 *   asocia a la caja ABIERTA del depósito y deja su MovimientoCaja en la misma
 *   transacción. Sin caja abierta queda "fuera de caja" (cajaId null), salvo
 *   que Configuracion.exigirCajaAbierta lo prohíba.
 * - ResumenDiario: cada operación recalcula, al final de su transacción, los
 *   días y depósitos que tocó.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const CERO = D(0);
const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const dec = (d: Prisma.Decimal) => d.toFixed(2);
const $ = (d: Prisma.Decimal) => formatearPesos(d.toFixed(2));
const efectivoDe = (pagos: { medioPago: MedioPago; monto: Prisma.Decimal }[]) =>
  pagos.filter((p) => p.medioPago === MedioPago.EFECTIVO).reduce((a, p) => a.plus(p.monto), CERO);

export interface PermisosVenta {
  /** VENTAS "editar": precio manual, descuento global, vender fiado. */
  puedeEditar: boolean;
}

function estadoPagoDe(montoPagado: Prisma.Decimal, saldo: Prisma.Decimal): EstadoPago {
  if (saldo.isZero()) return EstadoPago.PAGADA;
  return montoPagado.greaterThan(0) ? EstadoPago.PARCIAL : EstadoPago.PENDIENTE;
}

/**
 * Bloquea (FOR UPDATE) el cliente de la venta y después la venta, siempre en
 * ese orden. Si el cliente del borrador cambió entre la lectura y el bloqueo,
 * se aborta (la transacción se reintenta desde afuera o el usuario reintenta).
 */
async function bloquearVenta(tx: Tx, ventaId: string) {
  const previa = await tx.venta.findUnique({ where: { id: ventaId }, select: { clienteId: true } });
  if (!previa) throw new NotFoundError("La venta no existe");
  if (previa.clienteId)
    await tx.$queryRaw`SELECT "id" FROM "Cliente" WHERE "id" = ${previa.clienteId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Venta" WHERE "id" = ${ventaId} FOR UPDATE`;
  const venta = await tx.venta.findUniqueOrThrow({
    where: { id: ventaId },
    include: {
      cliente: true,
      deposito: { select: { nombre: true, activo: true } },
      items: {
        orderBy: { varianteId: "asc" },
        include: {
          variante: {
            select: {
              nombre: true,
              precioCosto: true,
              producto: { select: { nombre: true, tieneVariantes: true } },
            },
          },
        },
      },
    },
  });
  if (venta.clienteId !== previa.clienteId)
    throw new DomainError("La venta cambió mientras se procesaba. Reintentá.");
  return venta;
}

// =============================================================================
// Borrador
// =============================================================================

interface ItemCalculado {
  varianteId: string;
  cantidad: number;
  precioUnitario: Prisma.Decimal;
  costoUnitario: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  notas: string | null;
}

/** Precios del servidor (o manuales con permiso), descuento global y totales. */
async function calcularBorrador(
  tx: Tx,
  datos: BorradorVenta,
  actor: Actor,
  permisos: PermisosVenta,
) {
  const [deposito, cliente, variantes, usuario] = await Promise.all([
    tx.deposito.findUnique({
      where: { id: datos.depositoId },
      select: { activo: true, nombre: true },
    }),
    datos.clienteId
      ? tx.cliente.findFirst({
          where: { id: datos.clienteId, deletedAt: null },
          select: { activo: true, nombre: true },
        })
      : Promise.resolve(null),
    tx.variante.findMany({
      where: { id: { in: datos.items.map((i) => i.varianteId) }, deletedAt: null },
      select: {
        id: true,
        nombre: true,
        activo: true,
        precioVenta: true,
        precioCosto: true,
        producto: { select: { nombre: true, tieneVariantes: true, activo: true, deletedAt: true } },
      },
    }),
    tx.usuario.findUniqueOrThrow({ where: { id: actor.id }, select: { nombre: true } }),
  ]);
  if (!deposito) throw new NotFoundError("El depósito no existe");
  if (!deposito.activo) throw new DomainError(`El depósito "${deposito.nombre}" está inactivo`);
  if (datos.clienteId && !cliente)
    throw new NotFoundError("El cliente no existe o fue dado de baja");
  if (cliente && !cliente.activo)
    throw new DomainError(`El cliente "${cliente.nombre}" está inactivo`);

  const porId = new Map(variantes.map((v) => [v.id, v]));
  const items: ItemCalculado[] = datos.items.map((i) => {
    const v = porId.get(i.varianteId);
    if (!v || v.producto.deletedAt)
      throw new NotFoundError("Alguno de los productos no existe o fue dado de baja");
    const nombre = nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes);
    if (!v.activo || !v.producto.activo)
      throw new DomainError(`${nombre} está inactivo: no se puede vender`);
    let precio = v.precioVenta;
    let notas: string | null = null;
    if (i.precioUnitario !== undefined && !D(i.precioUnitario).equals(v.precioVenta)) {
      if (!permisos.puedeEditar)
        throw new ForbiddenError("No tenés permiso para cambiar precios en la venta.");
      precio = r2(D(i.precioUnitario));
      notas = `Precio modificado por ${usuario.nombre} de ${$(v.precioVenta)} a ${$(precio)}`;
    }
    return {
      varianteId: v.id,
      cantidad: i.cantidad,
      precioUnitario: precio,
      costoUnitario: v.precioCosto, // provisorio: al confirmar se toma el costo del momento
      subtotal: precio.mul(i.cantidad),
      notas,
    };
  });

  const subtotal = items.reduce((a, i) => a.plus(i.subtotal), CERO);
  let descuento = CERO;
  if (datos.descuentoGlobal) {
    if (!permisos.puedeEditar)
      throw new ForbiddenError("No tenés permiso para aplicar descuentos.");
    descuento =
      datos.descuentoGlobal.tipo === "monto"
        ? r2(D(datos.descuentoGlobal.valor))
        : r2(subtotal.mul(datos.descuentoGlobal.valor).div(100));
    if (descuento.greaterThan(subtotal)) {
      throw new DomainError("El descuento no puede superar el subtotal", "VALIDATION_ERROR", 400, {
        descuentoGlobal: [`Máximo ${$(subtotal)}`],
      });
    }
  }
  const total = subtotal.minus(descuento);
  const costoTotal = items.reduce((a, i) => a.plus(i.costoUnitario.mul(i.cantidad)), CERO);
  return { items, subtotal, descuento, total, costoTotal };
}

/** Venta en BORRADOR (presupuesto / cliente que vuelve después). No mueve stock. */
export async function crearBorrador(
  datos: BorradorVenta,
  actor: Actor,
  permisos: PermisosVenta,
  txExterna?: Tx,
): Promise<{ id: string; numero: number }> {
  const hacer = async (tx: Tx) => {
    const c = await calcularBorrador(tx, datos, actor, permisos);
    const venta = await tx.venta.create({
      data: {
        depositoId: datos.depositoId,
        clienteId: datos.clienteId ?? null,
        estado: EstadoVenta.BORRADOR,
        subtotal: c.subtotal,
        descuento: c.descuento,
        total: c.total,
        costoTotal: c.costoTotal,
        gananciaBruta: c.total.minus(c.costoTotal),
        notas: datos.notas ?? null,
        usuarioId: actor.id,
        items: { create: c.items },
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.CREATE,
      entidad: "Venta",
      entidadId: venta.id,
      datosDespues: {
        numero: venta.numero,
        estado: "BORRADOR",
        total: dec(c.total),
        items: c.items.length,
      },
      meta: actor.meta,
    });
    return { id: venta.id, numero: venta.numero };
  };
  return txExterna ? hacer(txExterna) : withTransaction(hacer);
}

/** Reemplaza datos e ítems de un BORRADOR. */
export async function actualizarBorrador(
  id: string,
  datos: BorradorVenta,
  actor: Actor,
  permisos: PermisosVenta,
  txExterna?: Tx,
): Promise<{ id: string; numero: number }> {
  const hacer = async (tx: Tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Venta" WHERE "id" = ${id} FOR UPDATE`;
    const antes = await tx.venta.findUnique({
      where: { id },
      select: { estado: true, numero: true, total: true },
    });
    if (!antes) throw new NotFoundError("La venta no existe");
    if (antes.estado !== EstadoVenta.BORRADOR) {
      throw new DomainError(
        `La venta #${antes.numero} ya está ${antes.estado.toLowerCase()}: no se edita.`,
      );
    }
    const c = await calcularBorrador(tx, datos, actor, permisos);
    await tx.ventaItem.deleteMany({ where: { ventaId: id } });
    await tx.venta.update({
      where: { id },
      data: {
        depositoId: datos.depositoId,
        clienteId: datos.clienteId ?? null,
        subtotal: c.subtotal,
        descuento: c.descuento,
        total: c.total,
        costoTotal: c.costoTotal,
        gananciaBruta: c.total.minus(c.costoTotal),
        notas: datos.notas ?? null,
        items: { create: c.items },
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "Venta",
      entidadId: id,
      datosAntes: { total: dec(antes.total) },
      datosDespues: { total: dec(c.total), items: c.items.length },
      meta: actor.meta,
    });
    return { id, numero: antes.numero };
  };
  return txExterna ? hacer(txExterna) : withTransaction(hacer);
}

// =============================================================================
// Confirmación (la función crítica)
// =============================================================================

export interface VentaConfirmada {
  id: string;
  numero: number;
  total: string;
  montoPagado: string;
  saldoPendiente: string;
  estadoPago: EstadoPago;
  comprobante: {
    id: string;
    tipo: TipoComprobante;
    puntoVenta: number;
    numero: number;
    pdfUrl: string | null;
  } | null;
}

/**
 * Confirma un BORRADOR: descuenta stock, congela costos, registra pagos,
 * cuenta corriente y comprobante, todo en UNA transacción Serializable.
 * Los precios son los del borrador (lo que vio el vendedor es lo que se cobra).
 */
export async function confirmarVenta(
  id: string,
  opciones: { pagos: PagoInput[]; redondearA?: RedondeoVenta | number },
  actor: Actor,
  permisos: PermisosVenta,
): Promise<VentaConfirmada> {
  const confirmada = await withTransaction(
    (tx) => confirmarEnTx(tx, id, opciones, actor, permisos),
    {
      maxRetries: 10, // 10 cajas cobrando a la vez el mismo sabor: cada conflicto se reintenta
      timeout: 30_000,
    },
  );
  // El PDF (archivo) se genera después del COMMIT: si falla, la venta igual quedó bien.
  if (confirmada.comprobante) {
    try {
      confirmada.comprobante.pdfUrl = (await obtenerPdfComprobante(confirmada.comprobante.id)).url;
    } catch (e) {
      console.error("[ventas] no se pudo generar el PDF del comprobante", e);
    }
  }
  return confirmada;
}

/** Cuerpo de confirmarVenta, para reutilizarlo dentro de otra transacción (vender en un paso). */
export async function confirmarEnTx(
  tx: Tx,
  id: string,
  opciones: { pagos: PagoInput[]; redondearA?: RedondeoVenta | number },
  actor: Actor,
  permisos: PermisosVenta,
): Promise<VentaConfirmada> {
  // 1. Bloqueo (cliente → venta) y estado.
  const venta = await bloquearVenta(tx, id);
  if (venta.estado !== EstadoVenta.BORRADOR) {
    throw new DomainError(`La venta #${venta.numero} ya está ${venta.estado.toLowerCase()}.`);
  }
  if (!venta.deposito.activo)
    throw new DomainError(`El depósito "${venta.deposito.nombre}" está inactivo`);
  if (venta.items.length === 0) throw new DomainError("La venta no tiene productos");

  // 2. Totales desde los ítems del borrador (sus precios, no los actuales de la variante).
  const subtotal = venta.items.reduce((a, i) => a.plus(i.subtotal), CERO);
  const base = subtotal.minus(venta.descuento);
  const multiplo = Number(opciones.redondearA ?? 0);
  // Redondeo hacia abajo al múltiplo: siempre a favor del cliente (redondeo ≤ 0).
  const total = multiplo > 1 ? base.div(multiplo).floor().mul(multiplo) : base;
  const redondeo = total.minus(base);

  // 3. Stock: primero se informa TODO lo que falta; después, un VENTA por ítem (todo o nada).
  const stocks = await tx.stock.findMany({
    where: {
      depositoId: venta.depositoId,
      varianteId: { in: venta.items.map((i) => i.varianteId) },
    },
    select: { varianteId: true, cantidad: true },
  });
  const disponible = new Map(stocks.map((s) => [s.varianteId, s.cantidad]));
  const faltan = venta.items
    .filter((i) => (disponible.get(i.varianteId) ?? 0) < i.cantidad)
    .map((i) => {
      const n = nombreCompleto(
        i.variante.producto.nombre,
        i.variante.nombre,
        i.variante.producto.tieneVariantes,
      );
      return `${n}: hay ${disponible.get(i.varianteId) ?? 0}, se piden ${i.cantidad}`;
    });
  if (faltan.length) {
    throw new DomainError(
      `Stock insuficiente en ${venta.deposito.nombre}. ${faltan.join(" · ")}`,
      "STOCK_INSUFICIENTE",
      409,
    );
  }
  for (const item of venta.items) {
    await registrarMovimiento(tx, {
      tipo: TipoMovimiento.VENTA,
      varianteId: item.varianteId,
      depositoId: venta.depositoId,
      cantidad: item.cantidad,
      costoUnitario: item.variante.precioCosto,
      motivo: `Venta #${venta.numero}`,
      referenciaTipo: "VENTA",
      referenciaId: venta.id,
      usuarioId: actor.id,
    });
  }

  // 4. Snapshot de costos (el de ahora, no el del borrador): la ganancia histórica queda fija.
  let costoTotal = CERO;
  for (const item of venta.items) {
    const costo = item.variante.precioCosto;
    costoTotal = costoTotal.plus(costo.mul(item.cantidad));
    if (!costo.equals(item.costoUnitario)) {
      await tx.ventaItem.update({ where: { id: item.id }, data: { costoUnitario: costo } });
    }
  }

  // 5. Pagos y cuenta corriente.
  const pagos = opciones.pagos.map((p) => ({ ...p, monto: r2(D(p.monto)) }));
  const pagado = pagos.reduce((a, p) => a.plus(p.monto), CERO);
  if (pagado.greaterThan(total)) {
    throw new DomainError(
      `Los pagos (${$(pagado)}) superan el total (${$(total)}). El vuelto se calcula en pantalla y no se registra.`,
      "VALIDATION_ERROR",
      400,
      { pagos: ["Los pagos superan el total"] },
    );
  }
  const usoSaldoAFavor = pagos
    .filter((p) => p.medioPago === MedioPago.CREDITO_CLIENTE)
    .reduce((a, p) => a.plus(p.monto), CERO);
  if (usoSaldoAFavor.greaterThan(0)) {
    if (!venta.cliente) throw new DomainError("Para usar saldo a favor elegí el cliente.");
    if (usoSaldoAFavor.greaterThan(venta.cliente.saldoAFavor)) {
      throw new DomainError(
        `${venta.cliente.nombre} tiene ${$(venta.cliente.saldoAFavor)} a favor, no ${$(usoSaldoAFavor)}.`,
      );
    }
  }
  const saldo = total.minus(pagado);
  if (saldo.greaterThan(0)) {
    // Fiado: decisión del dueño o de un empleado autorizado, con cliente y dentro de su límite.
    if (!permisos.puedeEditar)
      throw new ForbiddenError("No tenés permiso para vender fiado: cobrá el total.");
    if (!venta.cliente) throw new DomainError("Para dejar saldo pendiente elegí el cliente.");
    if (venta.cliente.limiteCredito === null) {
      throw new DomainError(
        `${venta.cliente.nombre} no tiene cuenta corriente habilitada (sin límite de crédito).`,
      );
    }
    const nuevoSaldo = venta.cliente.saldoDeudor.plus(saldo);
    if (nuevoSaldo.greaterThan(venta.cliente.limiteCredito)) {
      throw new DomainError(
        `Supera el límite de crédito de ${venta.cliente.nombre}: debe ${$(venta.cliente.saldoDeudor)}, límite ${$(venta.cliente.limiteCredito)}, esta venta deja ${$(saldo)} pendiente.`,
        "LIMITE_CREDITO",
        409,
      );
    }
  }

  const principal = [...pagos].sort((a, b) => b.monto.comparedTo(a.monto))[0]?.medioPago ?? null;
  const estadoPago = estadoPagoDe(pagado, saldo);
  // Efectivo: a la caja abierta del depósito (o "fuera de caja" si está permitido).
  const efectivo = efectivoDe(pagos);
  const caja = efectivo.greaterThan(0) ? await cajaParaEfectivo(tx, venta.depositoId) : null;
  const momento = ahora();
  // 6. Confirmada, con la fecha de ahora (no la del borrador).
  await tx.venta.update({
    where: { id },
    data: {
      estado: EstadoVenta.CONFIRMADA,
      fecha: momento,
      subtotal,
      redondeo,
      total,
      costoTotal,
      gananciaBruta: total.minus(costoTotal),
      montoPagado: pagado,
      saldoPendiente: saldo,
      estadoPago,
      medioPago: principal,
    },
  });
  if (pagos.length) {
    await tx.pagoVenta.createMany({
      data: pagos.map((p) => ({
        ventaId: id,
        medioPago: p.medioPago,
        monto: p.monto,
        referencia: p.referencia ?? null,
        usuarioId: actor.id,
        fecha: momento,
        cajaId: p.medioPago === MedioPago.EFECTIVO ? (caja?.id ?? null) : null,
      })),
    });
  }
  if (caja) {
    await registrarMovimientoCaja(tx, {
      cajaId: caja.id,
      tipo: "VENTA",
      monto: efectivo,
      referenciaTipo: "VENTA",
      referenciaId: id,
      descripcion: `Venta #${venta.numero}`,
      usuarioId: actor.id,
    });
  }
  if (venta.cliente && (saldo.greaterThan(0) || usoSaldoAFavor.greaterThan(0))) {
    await tx.cliente.update({
      where: { id: venta.cliente.id },
      data: { saldoDeudor: { increment: saldo }, saldoAFavor: { decrement: usoSaldoAFavor } },
    });
  }

  // 7. Comprobante (numeración bloqueada en esta misma transacción).
  const config = await obtenerConfigVentas(tx);
  const comprobante = config.emitirComprobanteAutomatico
    ? await emitirComprobante(tx, id, config.tipoComprobanteDefault, actor, config.puntoVenta)
    : null;

  // 8. Auditoría.
  await registrarAuditoria(tx, {
    usuarioId: actor.id,
    accion: AccionAuditoria.UPDATE,
    entidad: "Venta",
    entidadId: id,
    datosAntes: { estado: "BORRADOR" },
    datosDespues: {
      estado: "CONFIRMADA",
      total: dec(total),
      redondeo: dec(redondeo),
      costoTotal: dec(costoTotal),
      pagos: pagos.map((p) => ({ medioPago: p.medioPago, monto: dec(p.monto) })),
      saldoPendiente: dec(saldo),
      comprobante: comprobante ? `${comprobante.tipo} ${comprobante.numero}` : null,
      efectivo: efectivo.greaterThan(0) ? { monto: dec(efectivo), cajaId: caja?.id ?? null } : null,
    },
    meta: actor.meta,
  });

  // 9. Agregados del día.
  await recalcularResumenes(tx, [{ fecha: momento, depositoId: venta.depositoId }]);

  return {
    id,
    numero: venta.numero,
    total: dec(total),
    montoPagado: dec(pagado),
    saldoPendiente: dec(saldo),
    estadoPago,
    comprobante: comprobante ? { ...comprobante, pdfUrl: null } : null,
  };
}

/** POS: guarda (crea o actualiza) el borrador y lo confirma en la misma transacción. */
export async function vender(
  datos: { borradorId?: string; venta: BorradorVenta; pagos: PagoInput[]; redondearA: number },
  actor: Actor,
  permisos: PermisosVenta,
): Promise<VentaConfirmada> {
  const confirmada = await withTransaction(
    async (tx) => {
      const { id } = datos.borradorId
        ? await actualizarBorrador(datos.borradorId, datos.venta, actor, permisos, tx)
        : await crearBorrador(datos.venta, actor, permisos, tx);
      return confirmarEnTx(
        tx,
        id,
        { pagos: datos.pagos, redondearA: datos.redondearA },
        actor,
        permisos,
      );
    },
    { maxRetries: 10, timeout: 30_000 },
  );
  if (confirmada.comprobante) {
    try {
      confirmada.comprobante.pdfUrl = (await obtenerPdfComprobante(confirmada.comprobante.id)).url;
    } catch (e) {
      console.error("[ventas] no se pudo generar el PDF del comprobante", e);
    }
  }
  return confirmada;
}

/** Descarta un borrador (no tiene stock ni pagos: se borra). */
export async function descartarBorrador(id: string, actor: Actor): Promise<void> {
  await withTransaction(async (tx) => {
    const v = await tx.venta.findUnique({
      where: { id },
      select: { estado: true, numero: true, total: true },
    });
    if (!v) throw new NotFoundError("La venta no existe");
    if (v.estado !== EstadoVenta.BORRADOR)
      throw new DomainError(`La venta #${v.numero} no es un borrador: anulala.`);
    await tx.venta.delete({ where: { id } });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.DELETE,
      entidad: "Venta",
      entidadId: id,
      datosAntes: { numero: v.numero, estado: "BORRADOR", total: dec(v.total) },
      meta: actor.meta,
    });
  });
}

// =============================================================================
// Cobros de cuenta corriente
// =============================================================================

/** Cobra (todo o parte de) el saldo pendiente de una venta. */
export async function registrarPago(
  ventaId: string,
  pago: PagoInput,
  actor: Actor,
): Promise<{ montoPagado: string; saldoPendiente: string; estadoPago: EstadoPago }> {
  return withTransaction(
    async (tx) => {
      const venta = await bloquearVenta(tx, ventaId);
      if (venta.estado !== EstadoVenta.CONFIRMADA)
        throw new DomainError(`La venta #${venta.numero} no está confirmada.`);
      const monto = r2(D(pago.monto));
      if (monto.greaterThan(venta.saldoPendiente)) {
        throw new DomainError(
          `El pago (${$(monto)}) supera el saldo pendiente (${$(venta.saldoPendiente)}).`,
          "VALIDATION_ERROR",
          400,
          {
            monto: [`Máximo ${$(venta.saldoPendiente)}`],
          },
        );
      }
      const usaSaldo = pago.medioPago === MedioPago.CREDITO_CLIENTE;
      if (usaSaldo && (!venta.cliente || monto.greaterThan(venta.cliente.saldoAFavor))) {
        throw new DomainError("El cliente no tiene saldo a favor suficiente.");
      }
      const montoPagado = venta.montoPagado.plus(monto);
      const saldo = venta.saldoPendiente.minus(monto);
      const estadoPago = estadoPagoDe(montoPagado, saldo);
      const caja =
        pago.medioPago === MedioPago.EFECTIVO ? await cajaParaEfectivo(tx, venta.depositoId) : null;
      const momento = ahora();
      await tx.pagoVenta.create({
        data: {
          ventaId,
          medioPago: pago.medioPago,
          monto,
          referencia: pago.referencia ?? null,
          usuarioId: actor.id,
          fecha: momento,
          cajaId: caja?.id ?? null,
        },
      });
      if (caja) {
        await registrarMovimientoCaja(tx, {
          cajaId: caja.id,
          tipo: "PAGO_CLIENTE",
          monto,
          referenciaTipo: "VENTA",
          referenciaId: ventaId,
          descripcion: `Cobro venta #${venta.numero}`,
          usuarioId: actor.id,
        });
      }
      await tx.venta.update({
        where: { id: ventaId },
        data: { montoPagado, saldoPendiente: saldo, estadoPago },
      });
      if (venta.cliente) {
        await tx.cliente.update({
          where: { id: venta.cliente.id },
          data: {
            saldoDeudor: { decrement: monto },
            ...(usaSaldo ? { saldoAFavor: { decrement: monto } } : {}),
          },
        });
      }
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "PagoVenta",
        entidadId: ventaId,
        datosDespues: {
          venta: venta.numero,
          medioPago: pago.medioPago,
          monto: dec(monto),
          saldoPendiente: dec(saldo),
          cajaId: caja?.id ?? null,
        },
        meta: actor.meta,
      });
      await recalcularResumenes(tx, [{ fecha: momento, depositoId: venta.depositoId }]);
      return { montoPagado: dec(montoPagado), saldoPendiente: dec(saldo), estadoPago };
    },
    { maxRetries: 3 },
  );
}

/**
 * Pago a cuenta de un cliente: se imputa a sus ventas pendientes en el orden
 * pedido (por defecto, de la más vieja a la más nueva), un PagoVenta por venta.
 */
export async function pagarACuenta(
  input: PagoACuenta,
  actor: Actor,
): Promise<{
  imputaciones: { ventaId: string; numero: number; monto: string }[];
  saldoDeudor: string;
}> {
  return withTransaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Cliente" WHERE "id" = ${input.clienteId} FOR UPDATE`;
      const cliente = await tx.cliente.findFirst({
        where: { id: input.clienteId, deletedAt: null },
      });
      if (!cliente) throw new NotFoundError("El cliente no existe");
      const monto = r2(D(input.monto));
      if (monto.greaterThan(cliente.saldoDeudor)) {
        throw new DomainError(
          `El pago (${$(monto)}) supera lo que debe ${cliente.nombre} (${$(cliente.saldoDeudor)}).`,
          "VALIDATION_ERROR",
          400,
          {
            monto: [`Máximo ${$(cliente.saldoDeudor)}`],
          },
        );
      }
      const pendientes = await tx.$queryRaw<
        {
          id: string;
          numero: number;
          depositoId: string;
          montoPagado: Prisma.Decimal;
          saldoPendiente: Prisma.Decimal;
        }[]
      >`
        SELECT "id", "numero", "depositoId", "montoPagado", "saldoPendiente" FROM "Venta"
        WHERE "clienteId" = ${cliente.id} AND "estado" = 'CONFIRMADA' AND "saldoPendiente" > 0
        ORDER BY "fecha", "numero"
        FOR UPDATE
      `;
      const orden = input.ventaIds?.length
        ? [
            ...input.ventaIds.flatMap((vid) => pendientes.filter((p) => p.id === vid)),
            ...pendientes.filter((p) => !input.ventaIds!.includes(p.id)),
          ]
        : pendientes;
      // El efectivo entra a la caja del depósito indicado o, si no, al de la primera venta imputada.
      const depositoCobro = input.depositoId ?? orden[0]?.depositoId ?? null;
      const caja =
        input.medioPago === MedioPago.EFECTIVO && depositoCobro
          ? await cajaParaEfectivo(tx, depositoCobro)
          : null;
      const momento = ahora();
      const depositosTocados = new Set<string>();
      let resta = monto;
      const imputaciones: { ventaId: string; numero: number; monto: string }[] = [];
      for (const v of orden) {
        if (resta.isZero()) break;
        const parte = Prisma.Decimal.min(resta, v.saldoPendiente);
        const montoPagado = D(v.montoPagado).plus(parte);
        const saldo = D(v.saldoPendiente).minus(parte);
        await tx.pagoVenta.create({
          data: {
            ventaId: v.id,
            medioPago: input.medioPago,
            monto: parte,
            referencia: input.referencia ?? null,
            usuarioId: actor.id,
            fecha: momento,
            cajaId: caja?.id ?? null,
          },
        });
        depositosTocados.add(v.depositoId);
        await tx.venta.update({
          where: { id: v.id },
          data: {
            montoPagado,
            saldoPendiente: saldo,
            estadoPago: estadoPagoDe(montoPagado, saldo),
          },
        });
        imputaciones.push({ ventaId: v.id, numero: v.numero, monto: dec(parte) });
        resta = resta.minus(parte);
      }
      const saldoDeudor = cliente.saldoDeudor.minus(monto);
      await tx.cliente.update({ where: { id: cliente.id }, data: { saldoDeudor } });
      if (caja) {
        await registrarMovimientoCaja(tx, {
          cajaId: caja.id,
          tipo: "PAGO_CLIENTE",
          monto,
          referenciaTipo: "CLIENTE",
          referenciaId: cliente.id,
          descripcion: `Pago a cuenta de ${[cliente.nombre, cliente.apellido].filter(Boolean).join(" ")}`,
          usuarioId: actor.id,
        });
      }
      await recalcularResumenes(
        tx,
        [...depositosTocados].map((depositoId) => ({ fecha: momento, depositoId })),
      );
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "PagoACuenta",
        entidadId: cliente.id,
        datosDespues: { medioPago: input.medioPago, monto: dec(monto), imputaciones },
        meta: actor.meta,
      });
      return { imputaciones, saldoDeudor: dec(saldoDeudor) };
    },
    { maxRetries: 3 },
  );
}

/** Anula un pago (solo OWNER, lo valida la acción): la venta vuelve a deber ese monto. */
export async function anularPago(pagoId: string, motivo: string, actor: Actor): Promise<void> {
  await withTransaction(
    async (tx) => {
      const p = await tx.pagoVenta.findUnique({ where: { id: pagoId }, select: { ventaId: true } });
      if (!p) throw new NotFoundError("El pago no existe");
      const venta = await bloquearVenta(tx, p.ventaId);
      const pago = await tx.pagoVenta.findUniqueOrThrow({ where: { id: pagoId } });
      if (pago.anulado) throw new DomainError("El pago ya está anulado.");
      if (venta.estado !== EstadoVenta.CONFIRMADA)
        throw new DomainError(`La venta #${venta.numero} no está confirmada.`);
      await tx.pagoVenta.update({
        where: { id: pagoId },
        data: {
          anulado: true,
          anuladoPorId: actor.id,
          anuladoAt: ahora(),
          motivoAnulacion: motivo,
        },
      });
      // Si entró a una caja que sigue abierta, sale de ella (si ya cerró, el arqueo lo reflejó).
      if (pago.cajaId) {
        const caja = await tx.caja.findUnique({
          where: { id: pago.cajaId },
          select: { estado: true },
        });
        if (caja?.estado === "ABIERTA") {
          await tx.$queryRaw`SELECT "id" FROM "Caja" WHERE "id" = ${pago.cajaId} FOR SHARE`;
          await registrarMovimientoCaja(tx, {
            cajaId: pago.cajaId,
            tipo: "DEVOLUCION",
            monto: pago.monto.neg(),
            referenciaTipo: "VENTA",
            referenciaId: venta.id,
            descripcion: `Pago anulado (venta #${venta.numero}): ${motivo}`,
            usuarioId: actor.id,
          });
        }
      }
      const montoPagado = venta.montoPagado.minus(pago.monto);
      const saldo = venta.saldoPendiente.plus(pago.monto);
      await tx.venta.update({
        where: { id: venta.id },
        data: { montoPagado, saldoPendiente: saldo, estadoPago: estadoPagoDe(montoPagado, saldo) },
      });
      if (venta.cliente) {
        await tx.cliente.update({
          where: { id: venta.cliente.id },
          data: {
            saldoDeudor: { increment: pago.monto },
            // Si se había pagado con saldo a favor, ese crédito vuelve.
            ...(pago.medioPago === MedioPago.CREDITO_CLIENTE
              ? { saldoAFavor: { increment: pago.monto } }
              : {}),
          },
        });
      }
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "PagoVenta",
        entidadId: pagoId,
        datosAntes: { anulado: false, monto: dec(pago.monto), medioPago: pago.medioPago },
        datosDespues: { anulado: true, motivo, saldoPendiente: dec(saldo) },
        meta: actor.meta,
      });
      await recalcularResumenes(tx, [{ fecha: pago.fecha, depositoId: venta.depositoId }]);
    },
    { maxRetries: 3 },
  );
}

// =============================================================================
// Anulación y devoluciones
// =============================================================================

/**
 * Anula una venta CONFIRMADA sin devoluciones: la mercadería vuelve a su
 * depósito (DEVOLUCION_CLIENTE por ítem), se anulan los pagos, se revierte la
 * cuenta corriente y el comprobante queda ANULADO.
 */
export async function anularVenta(
  id: string,
  motivo: string,
  actor: Actor,
): Promise<{ numero: number }> {
  return withTransaction(
    async (tx) => {
      const venta = await bloquearVenta(tx, id);
      if (venta.estado !== EstadoVenta.CONFIRMADA)
        throw new DomainError(`La venta #${venta.numero} está ${venta.estado.toLowerCase()}.`);
      if ((await tx.devolucion.count({ where: { ventaId: id } })) > 0) {
        throw new DomainError(
          `La venta #${venta.numero} tiene devoluciones: devolvé el resto en vez de anularla.`,
        );
      }
      for (const item of venta.items) {
        await registrarMovimiento(tx, {
          tipo: TipoMovimiento.DEVOLUCION_CLIENTE,
          varianteId: item.varianteId,
          depositoId: venta.depositoId,
          cantidad: item.cantidad,
          costoUnitario: item.costoUnitario,
          motivo: `Anulación venta #${venta.numero}: ${motivo}`,
          referenciaTipo: "VENTA",
          referenciaId: venta.id,
          usuarioId: actor.id,
        });
      }
      const pagos = await tx.pagoVenta.findMany({ where: { ventaId: id, anulado: false } });
      // El efectivo cobrado se devuelve ahora, desde la caja abierta del depósito.
      const efectivo = efectivoDe(pagos);
      const caja = efectivo.greaterThan(0)
        ? await cajaParaEfectivo(tx, venta.depositoId, "devolver el efectivo")
        : null;
      const momento = ahora();
      await tx.pagoVenta.updateMany({
        where: { ventaId: id, anulado: false },
        data: {
          anulado: true,
          anuladoPorId: actor.id,
          anuladoAt: momento,
          motivoAnulacion: `Venta anulada: ${motivo}`,
        },
      });
      const saldoAFavorDevuelto = pagos
        .filter((p) => p.medioPago === MedioPago.CREDITO_CLIENTE)
        .reduce((a, p) => a.plus(p.monto), CERO);
      await tx.venta.update({
        where: { id },
        data: {
          estado: EstadoVenta.ANULADA,
          anuladaPorId: actor.id,
          anuladaAt: momento,
          motivoAnulacion: motivo,
          montoPagado: 0,
          saldoPendiente: 0,
        },
      });
      if (venta.cliente) {
        await tx.cliente.update({
          where: { id: venta.cliente.id },
          data: {
            saldoDeudor: { decrement: venta.saldoPendiente },
            saldoAFavor: { increment: saldoAFavorDevuelto },
          },
        });
      }
      await anularComprobanteDeVenta(tx, id, actor);
      if (caja) {
        await verificarEfectivoDisponible(tx, caja.id, efectivo, "devolver el efectivo cobrado");
        await registrarMovimientoCaja(tx, {
          cajaId: caja.id,
          tipo: "DEVOLUCION",
          monto: efectivo.neg(),
          referenciaTipo: "VENTA",
          referenciaId: id,
          descripcion: `Anulación venta #${venta.numero}`,
          usuarioId: actor.id,
        });
      }
      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.UPDATE,
        entidad: "Venta",
        entidadId: id,
        datosAntes: {
          estado: "CONFIRMADA",
          montoPagado: dec(venta.montoPagado),
          saldoPendiente: dec(venta.saldoPendiente),
        },
        datosDespues: { estado: "ANULADA", motivo, pagosAnulados: pagos.length },
        meta: actor.meta,
      });
      // El día de la venta (deja de contar) y los días en que se cobró (esos cobros se anulan).
      await recalcularResumenes(tx, [
        { fecha: venta.fecha, depositoId: venta.depositoId },
        ...pagos.map((p) => ({ fecha: p.fecha, depositoId: venta.depositoId })),
      ]);
      return { numero: venta.numero };
    },
    { maxRetries: 3, timeout: 30_000 },
  );
}

/**
 * Devolución parcial. El importe de cada unidad es su precio efectivo (con el
 * descuento global y el redondeo prorrateados). Reintegro:
 *  - "dinero": hasta lo efectivamente cobrado menos lo ya reintegrado.
 *  - "cuentaCorriente": primero cancela deuda (esta venta, después las más
 *    viejas) con pagos CREDITO_CLIENTE "Devolución #N"; el resto queda como
 *    saldo a favor del cliente.
 */
export async function crearDevolucion(
  input: DevolucionInput,
  actor: Actor,
): Promise<{
  id: string;
  numero: number;
  total: string;
  reintegroMonto: string;
  aCuentaCorriente: string;
  saldoAFavor: string | null;
}> {
  return withTransaction(
    async (tx) => {
      const venta = await bloquearVenta(tx, input.ventaId);
      if (venta.estado !== EstadoVenta.CONFIRMADA)
        throw new DomainError(`La venta #${venta.numero} está ${venta.estado.toLowerCase()}.`);
      const deposito = await tx.deposito.findUnique({
        where: { id: input.depositoId },
        select: { activo: true, nombre: true },
      });
      if (!deposito) throw new NotFoundError("El depósito no existe");
      if (!deposito.activo) throw new DomainError(`El depósito "${deposito.nombre}" está inactivo`);

      // Ítems bloqueados (la venta ya lo está: nadie más devuelve de esta venta en paralelo).
      const porId = new Map(venta.items.map((i) => [i.id, i]));
      const factor = venta.subtotal.isZero() ? CERO : venta.total.div(venta.subtotal);
      const lineas = input.items.map((pedido) => {
        const item = porId.get(pedido.ventaItemId);
        if (!item) throw new DomainError("Ese producto no es de esta venta");
        const nombre = nombreCompleto(
          item.variante.producto.nombre,
          item.variante.nombre,
          item.variante.producto.tieneVariantes,
        );
        const quedan = item.cantidad - item.cantidadDevuelta;
        if (pedido.cantidad > quedan) {
          throw new DomainError(
            `${nombre}: se vendieron ${item.cantidad} y ya se devolvieron ${item.cantidadDevuelta}; se pueden devolver ${quedan}, no ${pedido.cantidad}.`,
            "VALIDATION_ERROR",
            400,
          );
        }
        const precioEfectivo = r2(item.subtotal.div(item.cantidad).mul(factor));
        return {
          item,
          cantidad: pedido.cantidad,
          precioUnitario: precioEfectivo,
          subtotal: precioEfectivo.mul(pedido.cantidad),
          nombre,
        };
      });
      const total = lineas.reduce((a, l) => a.plus(l.subtotal), CERO);
      if (total.lessThanOrEqualTo(0))
        throw new DomainError("Esos productos se vendieron a $0: no hay nada que reintegrar.");

      let reintegroMonto = CERO;
      let aCuentaCorriente = CERO;
      const momento = ahora();
      if (input.reintegro.tipo === "dinero") {
        const yaReintegrado =
          (
            await tx.devolucion.aggregate({
              where: { ventaId: venta.id },
              _sum: { reintegroMonto: true },
            })
          )._sum.reintegroMonto ?? CERO;
        const maximo = venta.montoPagado.minus(yaReintegrado);
        if (total.greaterThan(maximo)) {
          throw new DomainError(
            `De esta venta se cobraron ${$(venta.montoPagado)}${yaReintegrado.greaterThan(0) ? ` y ya se reintegraron ${$(yaReintegrado)}` : ""}: se pueden devolver en dinero hasta ${$(maximo)}. Acreditá el resto a la cuenta del cliente.`,
          );
        }
        reintegroMonto = total;
      } else {
        if (!venta.cliente)
          throw new DomainError("La venta no tiene cliente: el reintegro tiene que ser en dinero.");
        aCuentaCorriente = total;
      }

      // Reintegro en efectivo: sale de la caja del depósito donde vuelve la mercadería.
      const caja =
        input.reintegro.tipo === "dinero" && input.reintegro.medioPago === MedioPago.EFECTIVO
          ? await cajaParaEfectivo(tx, input.depositoId, "devolver el efectivo")
          : null;
      const devolucion = await tx.devolucion.create({
        data: {
          ventaId: venta.id,
          depositoId: input.depositoId,
          fecha: momento,
          motivo: input.motivo,
          total,
          reintegroMedioPago: input.reintegro.tipo === "dinero" ? input.reintegro.medioPago : null,
          reintegroMonto,
          aCuentaCorriente,
          usuarioId: actor.id,
          items: {
            create: lineas.map((l) => ({
              ventaItemId: l.item.id,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              subtotal: l.subtotal,
            })),
          },
        },
      });

      for (const l of [...lineas].sort((a, b) =>
        a.item.varianteId.localeCompare(b.item.varianteId),
      )) {
        await registrarMovimiento(tx, {
          tipo: TipoMovimiento.DEVOLUCION_CLIENTE,
          varianteId: l.item.varianteId,
          depositoId: input.depositoId,
          cantidad: l.cantidad,
          costoUnitario: l.item.costoUnitario,
          motivo: `Devolución #${devolucion.numero} (venta #${venta.numero}): ${input.motivo}`,
          referenciaTipo: "DEVOLUCION",
          referenciaId: devolucion.id,
          usuarioId: actor.id,
        });
        await tx.ventaItem.update({
          where: { id: l.item.id },
          data: { cantidadDevuelta: { increment: l.cantidad } },
        });
      }

      if (caja && reintegroMonto.greaterThan(0)) {
        await verificarEfectivoDisponible(tx, caja.id, reintegroMonto, "devolver en efectivo");
        await registrarMovimientoCaja(tx, {
          cajaId: caja.id,
          tipo: "DEVOLUCION",
          monto: reintegroMonto.neg(),
          referenciaTipo: "VENTA",
          referenciaId: venta.id,
          descripcion: `Devolución #${devolucion.numero} (venta #${venta.numero})`,
          usuarioId: actor.id,
        });
      }

      // A cuenta corriente: cancela deuda (esta venta primero) y el resto queda a favor.
      let saldoAFavor: Prisma.Decimal | null = null;
      const depositosTocados = new Set([input.depositoId, venta.depositoId]);
      if (aCuentaCorriente.greaterThan(0) && venta.cliente) {
        const pendientes = await tx.$queryRaw<
          {
            id: string;
            depositoId: string;
            montoPagado: Prisma.Decimal;
            saldoPendiente: Prisma.Decimal;
          }[]
        >`
          SELECT "id", "depositoId", "montoPagado", "saldoPendiente" FROM "Venta"
          WHERE "clienteId" = ${venta.cliente.id} AND "estado" = 'CONFIRMADA' AND "saldoPendiente" > 0
          ORDER BY ("id" = ${venta.id}) DESC, "fecha", "numero"
          FOR UPDATE
        `;
        let resta = aCuentaCorriente;
        for (const v of pendientes) {
          if (resta.isZero()) break;
          const parte = Prisma.Decimal.min(resta, v.saldoPendiente);
          const montoPagado = D(v.montoPagado).plus(parte);
          const saldo = D(v.saldoPendiente).minus(parte);
          await tx.pagoVenta.create({
            data: {
              ventaId: v.id,
              medioPago: MedioPago.CREDITO_CLIENTE,
              monto: parte,
              referencia: `Devolución #${devolucion.numero}`,
              usuarioId: actor.id,
              fecha: momento,
            },
          });
          depositosTocados.add(v.depositoId);
          await tx.venta.update({
            where: { id: v.id },
            data: {
              montoPagado,
              saldoPendiente: saldo,
              estadoPago: estadoPagoDe(montoPagado, saldo),
            },
          });
          resta = resta.minus(parte);
        }
        const deudaCancelada = aCuentaCorriente.minus(resta);
        await tx.cliente.update({
          where: { id: venta.cliente.id },
          data: { saldoDeudor: { decrement: deudaCancelada }, saldoAFavor: { increment: resta } },
        });
        saldoAFavor = venta.cliente.saldoAFavor.plus(resta);
      }

      await registrarAuditoria(tx, {
        usuarioId: actor.id,
        accion: AccionAuditoria.CREATE,
        entidad: "Devolucion",
        entidadId: devolucion.id,
        datosDespues: {
          numero: devolucion.numero,
          venta: venta.numero,
          total: dec(total),
          reintegroMonto: dec(reintegroMonto),
          aCuentaCorriente: dec(aCuentaCorriente),
          items: lineas.map((l) => ({
            producto: l.nombre,
            cantidad: l.cantidad,
            precioUnitario: dec(l.precioUnitario),
          })),
          cajaId: caja?.id ?? null,
        },
        meta: actor.meta,
      });
      await recalcularResumenes(
        tx,
        [...depositosTocados].map((depositoId) => ({ fecha: momento, depositoId })),
      );
      return {
        id: devolucion.id,
        numero: devolucion.numero,
        total: dec(total),
        reintegroMonto: dec(reintegroMonto),
        aCuentaCorriente: dec(aCuentaCorriente),
        saldoAFavor: saldoAFavor ? dec(saldoAFavor) : null,
      };
    },
    { maxRetries: 3, timeout: 30_000 },
  );
}

// =============================================================================
// Lectura
// =============================================================================

function whereVentas(f: Omit<FiltrosVentas, "page" | "pageSize">): Prisma.VentaWhereInput {
  const where: Prisma.VentaWhereInput = {};
  if (f.estado) where.estado = f.estado;
  if (f.estadoPago) where.estadoPago = f.estadoPago;
  if (f.depositoId) where.depositoId = f.depositoId;
  if (f.clienteId) where.clienteId = f.clienteId;
  if (f.usuarioId) where.usuarioId = f.usuarioId;
  if (f.medioPago) where.pagos = { some: { medioPago: f.medioPago, anulado: false } };
  if (f.desde || f.hasta) {
    where.fecha = {
      ...(f.desde ? { gte: inicioDelDia(f.desde) } : {}),
      ...(f.hasta ? { lte: finDelDia(f.hasta) } : {}),
    };
  }
  const q = f.q?.trim().replace(/^#/, "");
  if (q) {
    where.OR = /^\d+$/.test(q)
      ? [{ numero: Number(q) }, { cliente: { documento: { contains: q } } }]
      : [
          { cliente: { nombre: { contains: q, mode: "insensitive" } } },
          { cliente: { apellido: { contains: q, mode: "insensitive" } } },
        ];
  }
  return where;
}

export interface VentaListada {
  id: string;
  numero: number;
  fecha: Date;
  estado: EstadoVenta;
  estadoPago: EstadoPago;
  cliente: string | null;
  vendedor: string;
  deposito: string;
  items: number;
  unidades: number;
  total: string;
  saldoPendiente: string;
  gananciaBruta: string;
  medioPago: MedioPago | null;
}

export async function listarVentas(f: FiltrosVentas): Promise<{
  ventas: VentaListada[];
  total: number;
  page: number;
  pageSize: number;
  resumen: { cantidad: number; total: string; gananciaBruta: string };
}> {
  const where = whereVentas(f);
  const [total, filas, agregado] = await Promise.all([
    prisma.venta.count({ where }),
    prisma.venta.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        cliente: { select: { nombre: true, apellido: true } },
        usuario: { select: { nombre: true } },
        deposito: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
    // Totales del rango: solo lo vendido de verdad (confirmadas).
    prisma.venta.aggregate({
      where: { AND: [where, { estado: EstadoVenta.CONFIRMADA }] },
      _count: true,
      _sum: { total: true, gananciaBruta: true },
    }),
  ]);
  return {
    ventas: filas.map((v) => ({
      id: v.id,
      numero: v.numero,
      fecha: v.fecha,
      estado: v.estado,
      estadoPago: v.estadoPago,
      cliente: v.cliente ? [v.cliente.nombre, v.cliente.apellido].filter(Boolean).join(" ") : null,
      vendedor: v.usuario.nombre,
      deposito: v.deposito.nombre,
      items: v.items.length,
      unidades: v.items.reduce((a, i) => a + i.cantidad, 0),
      total: dec(v.total),
      saldoPendiente: dec(v.saldoPendiente),
      gananciaBruta: dec(v.gananciaBruta),
      medioPago: v.medioPago,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
    resumen: {
      cantidad: agregado._count,
      total: dec(agregado._sum.total ?? CERO),
      gananciaBruta: dec(agregado._sum.gananciaBruta ?? CERO),
    },
  };
}

export async function obtenerVenta(id: string) {
  const v = await prisma.venta.findUnique({
    where: { id },
    include: {
      cliente: {
        select: {
          id: true,
          nombre: true,
          apellido: true,
          telefono: true,
          documento: true,
          saldoAFavor: true,
          saldoDeudor: true,
        },
      },
      usuario: { select: { nombre: true } },
      anuladaPor: { select: { nombre: true } },
      deposito: { select: { id: true, nombre: true } },
      comprobante: true,
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variante: {
            select: {
              id: true,
              nombre: true,
              sku: true,
              codigoBarras: true,
              producto: { select: { id: true, nombre: true, tieneVariantes: true } },
            },
          },
        },
      },
      pagos: {
        orderBy: { fecha: "asc" },
        include: {
          usuario: { select: { nombre: true } },
          anuladoPor: { select: { nombre: true } },
        },
      },
      devoluciones: {
        orderBy: { numero: "asc" },
        include: {
          usuario: { select: { nombre: true } },
          deposito: { select: { nombre: true } },
          items: true,
        },
      },
    },
  });
  if (!v) throw new NotFoundError("La venta no existe");
  const devolucionIds = v.devoluciones.map((d) => d.id);
  const movimientos = await prisma.movimientoStock.count({
    where: {
      OR: [
        { referenciaTipo: "VENTA", referenciaId: id },
        ...(devolucionIds.length
          ? [{ referenciaTipo: "DEVOLUCION", referenciaId: { in: devolucionIds } }]
          : []),
      ],
    },
  });
  const nombreItem = new Map(
    v.items.map((i) => [
      i.id,
      nombreCompleto(
        i.variante.producto.nombre,
        i.variante.nombre,
        i.variante.producto.tieneVariantes,
      ),
    ]),
  );
  return {
    id: v.id,
    numero: v.numero,
    fecha: v.fecha,
    estado: v.estado,
    estadoPago: v.estadoPago,
    cliente: v.cliente
      ? {
          id: v.cliente.id,
          nombre: [v.cliente.nombre, v.cliente.apellido].filter(Boolean).join(" "),
          telefono: v.cliente.telefono,
          documento: v.cliente.documento,
          saldoAFavor: dec(v.cliente.saldoAFavor),
          saldoDeudor: dec(v.cliente.saldoDeudor),
        }
      : null,
    vendedor: v.usuario.nombre,
    deposito: v.deposito,
    subtotal: dec(v.subtotal),
    descuento: dec(v.descuento),
    redondeo: dec(v.redondeo),
    total: dec(v.total),
    costoTotal: dec(v.costoTotal),
    gananciaBruta: dec(v.gananciaBruta),
    montoPagado: dec(v.montoPagado),
    saldoPendiente: dec(v.saldoPendiente),
    notas: v.notas,
    anulacion: v.anuladaAt
      ? { por: v.anuladaPor?.nombre ?? "", at: v.anuladaAt, motivo: v.motivoAnulacion }
      : null,
    comprobante: v.comprobante
      ? {
          id: v.comprobante.id,
          tipo: v.comprobante.tipo,
          puntoVenta: v.comprobante.puntoVenta,
          numero: v.comprobante.numero,
          estado: v.comprobante.estado,
          pdfUrl: v.comprobante.pdfUrl,
        }
      : null,
    items: v.items.map((i) => ({
      id: i.id,
      varianteId: i.varianteId,
      productoId: i.variante.producto.id,
      nombre: nombreItem.get(i.id) ?? "",
      sku: i.variante.sku,
      cantidad: i.cantidad,
      cantidadDevuelta: i.cantidadDevuelta,
      precioUnitario: dec(i.precioUnitario),
      costoUnitario: dec(i.costoUnitario),
      subtotal: dec(i.subtotal),
      notas: i.notas,
    })),
    pagos: v.pagos.map((p) => ({
      id: p.id,
      medioPago: p.medioPago,
      etiqueta: ETIQUETA_MEDIO_PAGO[p.medioPago],
      monto: dec(p.monto),
      referencia: p.referencia,
      fecha: p.fecha,
      usuario: p.usuario.nombre,
      anulado: p.anulado,
      anulacion: p.anulado ? { por: p.anuladoPor?.nombre ?? "", motivo: p.motivoAnulacion } : null,
    })),
    devoluciones: v.devoluciones.map((d) => ({
      id: d.id,
      numero: d.numero,
      fecha: d.fecha,
      motivo: d.motivo,
      deposito: d.deposito.nombre,
      usuario: d.usuario.nombre,
      total: dec(d.total),
      reintegroMonto: dec(d.reintegroMonto),
      reintegroMedioPago: d.reintegroMedioPago,
      aCuentaCorriente: dec(d.aCuentaCorriente),
      items: d.items.map((di) => ({
        nombre: nombreItem.get(di.ventaItemId) ?? "",
        cantidad: di.cantidad,
        subtotal: dec(di.subtotal),
      })),
    })),
    movimientos,
  };
}

export type VentaDetalle = Awaited<ReturnType<typeof obtenerVenta>>;

/** Para retomar un borrador en el POS. */
export async function obtenerBorradorParaPos(id: string) {
  const v = await prisma.venta.findUnique({
    where: { id },
    include: {
      cliente: {
        select: {
          id: true,
          nombre: true,
          apellido: true,
          telefono: true,
          limiteCredito: true,
          saldoDeudor: true,
          saldoAFavor: true,
        },
      },
      items: {
        orderBy: { createdAt: "asc" },
        select: { varianteId: true, cantidad: true, precioUnitario: true },
      },
    },
  });
  if (!v) throw new NotFoundError("La venta no existe");
  if (v.estado !== EstadoVenta.BORRADOR)
    throw new DomainError(`La venta #${v.numero} ya no es un borrador.`);
  return v;
}

// =============================================================================
// Agregados (Prompt 6: reportes y dashboard) — SQL agregado sobre índices,
// nunca se traen las ventas a memoria.
// =============================================================================

export interface RangoVentas {
  desde: Date;
  hasta: Date;
  depositoId?: string;
}

/**
 * `fecha` es timestamp SIN zona (UTC) y la sesión de Postgres está en hora
 * argentina: un Date como parámetro (timestamptz) se compararía corrido 3 h.
 * Se convierte explícitamente a UTC.
 */
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

const filtroDeposito = (depositoId?: string) =>
  depositoId ? Prisma.sql`AND v."depositoId" = ${depositoId}` : Prisma.empty;

export async function resumenVentas(r: RangoVentas) {
  const [fila] = await prisma.$queryRaw<
    {
      cantidad: bigint;
      total: Prisma.Decimal | null;
      costo: Prisma.Decimal | null;
      ganancia: Prisma.Decimal | null;
      unidades: bigint | null;
    }[]
  >`
    SELECT COUNT(*) AS cantidad, SUM(v."total") AS total, SUM(v."costoTotal") AS costo, SUM(v."gananciaBruta") AS ganancia,
           (SELECT SUM(vi."cantidad") FROM "VentaItem" vi JOIN "Venta" v2 ON v2."id" = vi."ventaId"
             WHERE v2."estado" = 'CONFIRMADA' AND v2."fecha" BETWEEN ${utc(r.desde)} AND ${utc(r.hasta)}
             ${r.depositoId ? Prisma.sql`AND v2."depositoId" = ${r.depositoId}` : Prisma.empty}) AS unidades
    FROM "Venta" v
    WHERE v."estado" = 'CONFIRMADA' AND v."fecha" BETWEEN ${utc(r.desde)} AND ${utc(r.hasta)} ${filtroDeposito(r.depositoId)}
  `;
  const medios = await prisma.$queryRaw<
    { medioPago: MedioPago; total: Prisma.Decimal; cantidad: bigint }[]
  >`
    SELECT p."medioPago", SUM(p."monto") AS total, COUNT(*) AS cantidad
    FROM "PagoVenta" p JOIN "Venta" v ON v."id" = p."ventaId"
    WHERE NOT p."anulado" AND v."estado" = 'CONFIRMADA' AND v."fecha" BETWEEN ${utc(r.desde)} AND ${utc(r.hasta)} ${filtroDeposito(r.depositoId)}
    GROUP BY p."medioPago" ORDER BY total DESC
  `;
  const [devol] = await prisma.$queryRaw<{ total: Prisma.Decimal | null; cantidad: bigint }[]>`
    SELECT SUM(d."total") AS total, COUNT(*) AS cantidad FROM "Devolucion" d
    WHERE d."fecha" BETWEEN ${utc(r.desde)} AND ${utc(r.hasta)} ${r.depositoId ? Prisma.sql`AND d."depositoId" = ${r.depositoId}` : Prisma.empty}
  `;
  const cantidad = Number(fila?.cantidad ?? 0);
  const total = D(fila?.total ?? 0);
  return {
    cantidad,
    total: dec(total),
    costo: dec(D(fila?.costo ?? 0)),
    gananciaBruta: dec(D(fila?.ganancia ?? 0)),
    ticketPromedio: dec(cantidad ? r2(total.div(cantidad)) : CERO),
    unidades: Number(fila?.unidades ?? 0),
    porMedioPago: medios.map((m) => ({
      medioPago: m.medioPago,
      total: dec(D(m.total)),
      cantidad: Number(m.cantidad),
    })),
    devoluciones: { cantidad: Number(devol?.cantidad ?? 0), total: dec(D(devol?.total ?? 0)) },
  };
}

/** Serie diaria (día calendario argentino). */
export async function ventasPorDia(r: RangoVentas) {
  const filas = await prisma.$queryRaw<
    { dia: Date; cantidad: bigint; total: Prisma.Decimal; ganancia: Prisma.Decimal }[]
  >`
    SELECT date_trunc('day', v."fecha" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires') AS dia,
           COUNT(*) AS cantidad, SUM(v."total") AS total, SUM(v."gananciaBruta") AS ganancia
    FROM "Venta" v
    WHERE v."estado" = 'CONFIRMADA' AND v."fecha" BETWEEN ${utc(r.desde)} AND ${utc(r.hasta)} ${filtroDeposito(r.depositoId)}
    GROUP BY 1 ORDER BY 1
  `;
  return filas.map((f) => ({
    dia: f.dia.toISOString().slice(0, 10),
    cantidad: Number(f.cantidad),
    total: dec(D(f.total)),
    gananciaBruta: dec(D(f.ganancia)),
  }));
}

/** Variantes más vendidas (unidades netas de devoluciones). */
export async function topVariantes(r: RangoVentas & { limit?: number }) {
  const filas = await prisma.$queryRaw<
    {
      varianteId: string;
      variante: string;
      producto: string;
      tieneVariantes: boolean;
      unidades: bigint;
      total: Prisma.Decimal;
      ganancia: Prisma.Decimal;
    }[]
  >`
    SELECT vi."varianteId", va."nombre" AS variante, p."nombre" AS producto, p."tieneVariantes",
           SUM(vi."cantidad" - vi."cantidadDevuelta") AS unidades,
           SUM(vi."subtotal") AS total,
           SUM(vi."subtotal" - vi."cantidad" * vi."costoUnitario") AS ganancia
    FROM "VentaItem" vi
    JOIN "Venta" v ON v."id" = vi."ventaId"
    JOIN "Variante" va ON va."id" = vi."varianteId"
    JOIN "Producto" p ON p."id" = va."productoId"
    WHERE v."estado" = 'CONFIRMADA' AND v."fecha" BETWEEN ${utc(r.desde)} AND ${utc(r.hasta)} ${filtroDeposito(r.depositoId)}
    GROUP BY vi."varianteId", va."nombre", p."nombre", p."tieneVariantes"
    ORDER BY unidades DESC
    LIMIT ${r.limit ?? 10}
  `;
  return filas.map((f) => ({
    varianteId: f.varianteId,
    nombre: nombreCompleto(f.producto, f.variante, f.tieneVariantes),
    unidades: Number(f.unidades),
    total: dec(D(f.total)),
    gananciaBruta: dec(D(f.ganancia)),
  }));
}

export async function ventasPorVendedor(r: RangoVentas) {
  const filas = await prisma.$queryRaw<
    {
      usuarioId: string;
      nombre: string;
      cantidad: bigint;
      total: Prisma.Decimal;
      ganancia: Prisma.Decimal;
    }[]
  >`
    SELECT v."usuarioId", u."nombre", COUNT(*) AS cantidad, SUM(v."total") AS total, SUM(v."gananciaBruta") AS ganancia
    FROM "Venta" v JOIN "Usuario" u ON u."id" = v."usuarioId"
    WHERE v."estado" = 'CONFIRMADA' AND v."fecha" BETWEEN ${utc(r.desde)} AND ${utc(r.hasta)} ${filtroDeposito(r.depositoId)}
    GROUP BY v."usuarioId", u."nombre" ORDER BY total DESC
  `;
  return filas.map((f) => ({
    usuarioId: f.usuarioId,
    nombre: f.nombre,
    cantidad: Number(f.cantidad),
    total: dec(D(f.total)),
    gananciaBruta: dec(D(f.ganancia)),
  }));
}

/**
 * Grilla rápida del POS: los productos más vendidos de los últimos 30 días
 * (si todavía no hay ventas, los de más stock), con sus sabores y el stock
 * de cada uno en el depósito elegido.
 */
export async function productosRapidos(depositoId: string, limite = 12) {
  const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const vendidos = await prisma.$queryRaw<{ productoId: string }[]>`
    SELECT va."productoId" FROM "VentaItem" vi
    JOIN "Venta" v ON v."id" = vi."ventaId"
    JOIN "Variante" va ON va."id" = vi."varianteId"
    WHERE v."estado" = 'CONFIRMADA' AND v."fecha" >= ${utc(desde)}
    GROUP BY va."productoId" ORDER BY SUM(vi."cantidad") DESC LIMIT ${limite}
  `;
  const ids = vendidos.map((v) => v.productoId);
  if (ids.length < limite) {
    const extra = await prisma.$queryRaw<{ productoId: string }[]>`
      SELECT va."productoId" FROM "Stock" s JOIN "Variante" va ON va."id" = s."varianteId"
      JOIN "Producto" p ON p."id" = va."productoId"
      WHERE s."depositoId" = ${depositoId} AND p."deletedAt" IS NULL AND p."activo" AND va."deletedAt" IS NULL AND va."activo"
      GROUP BY va."productoId" ORDER BY SUM(s."cantidad") DESC LIMIT ${limite * 2}
    `;
    for (const e of extra)
      if (ids.length < limite && !ids.includes(e.productoId)) ids.push(e.productoId);
  }
  const productos = await prisma.producto.findMany({
    where: { id: { in: ids }, deletedAt: null, activo: true },
    select: {
      id: true,
      nombre: true,
      tieneVariantes: true,
      imagenUrl: true,
      variantes: {
        where: { deletedAt: null, activo: true },
        orderBy: { nombre: "asc" },
        select: {
          id: true,
          nombre: true,
          sku: true,
          precioVenta: true,
          stocks: { where: { depositoId }, select: { cantidad: true } },
        },
      },
    },
  });
  const orden = new Map(ids.map((id, i) => [id, i]));
  return productos
    .filter((p) => p.variantes.length > 0)
    .sort((a, b) => (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0))
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      tieneVariantes: p.tieneVariantes,
      imagenUrl: p.imagenUrl,
      variantes: p.variantes.map((v) => ({
        varianteId: v.id,
        nombre: v.nombre,
        nombreCompleto: nombreCompleto(p.nombre, v.nombre, p.tieneVariantes),
        sku: v.sku,
        precioVenta: dec(v.precioVenta),
        stock: v.stocks[0]?.cantidad ?? 0,
      })),
    }));
}

export type ProductoRapido = Awaited<ReturnType<typeof productosRapidos>>[number];
