import {
  AccionAuditoria,
  EstadoDevolucion,
  EstadoPago,
  EstadoVenta,
  MedioPago,
  Prisma,
  RolUsuario,
  TipoMovimiento,
  TipoVenta,
} from "@prisma/client";

import { finDelDia, inicioDelDia } from "@/lib/fechas";
import { formatearIdVenta, numeroDeIdVenta } from "@/lib/paneles";
import { costoParaVenta, precioVentaEfectivo } from "@/lib/precios";
import { ahora } from "@/lib/reloj";
import type { FiltrosVentas, GenerarVenta } from "@/lib/validations/venta";
import { nombreConSabor, saborVisible } from "@/lib/ventas-ui";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { siguienteNumero } from "@/server/db/secuencia";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { medir } from "@/server/log";
import { registrarAuditoria } from "@/server/services/audit.service";
import { crearCliente } from "@/server/services/cliente.service";
import {
  bloquearCliente,
  estadoPagoDe,
  puedeFiados,
  type CtxFiados,
} from "@/server/services/fiado.service";
import { registrarMovimiento } from "@/server/services/stock.service";

/**
 * VENTAS (por panel)
 * - Una venta se genera CONFIRMADA de una sola vez (no hay borradores): galpón,
 *   cliente (existente o nuevo), sabores y sus pagos (hasta 3 medios). Todo o
 *   nada, en una transacción Serializable con reintentos.
 * - Pagos: Σ pagos ≤ total. Si no cubren el total la venta queda fiada
 *   (PARCIAL/PENDIENTE, FIADOS "crear") y el saldo se suma a la cuenta
 *   corriente del cliente en la misma transacción (ver fiado.service).
 * - Precio de lista y costo SIEMPRE del servidor: precioVentaEfectivo del sabor
 *   y snapshot de su último costo (costoParaVenta). El precio especial y el
 *   descuento global exigen "editar" en VENTAS.
 * - `numero` es correlativo por panel (Secuencia VENTA) y se toma en la misma
 *   transacción; `codigo` = formatearIdVenta(slug, numero) ("VAP-000001").
 * - Costos y ganancia: solo los ve el OWNER (`verCostos`); a un empleado no le llegan.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const CERO = D(0);
const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const dec = (d: Prisma.Decimal) => d.toFixed(2);

export interface PermisosVenta {
  /** VENTAS "editar": precio especial y descuento global. */
  puedeEditar: boolean;
  /**
   * "COTIZACION": la venta sale de una cotización guardada (convertirEnVenta).
   * Sus precios especiales y su descuento ya los fijó la cotización, así que
   * no exigen "editar"; la venta queda vinculada con `cotizacionId`.
   */
  origen?: "COTIZACION";
  cotizacionId?: string;
}

export interface OpcionesLectura {
  /** Solo OWNER: costos y ganancia. */
  verCostos: boolean;
}

/** Slug del panel (para el ID de venta): del ctx de la request si viene, si no de la DB. */
async function slugDelPanel(db: Tx, ctx: Ctx): Promise<string> {
  const conPanel = ctx as Ctx & { panel?: { slug?: string } };
  if (conPanel.panel?.slug) return conPanel.panel.slug;
  const panel = await db.panel.findUniqueOrThrow({
    where: { id: ctx.panelId },
    select: { slug: true },
  });
  return panel.slug;
}

// =============================================================================
// Generar venta (la función crítica)
// =============================================================================

export interface ItemVentaGenerada {
  varianteId: string;
  productoId: string;
  titulo: string;
  cantidad: number;
  precioLista: string;
  precioUnitario: string;
  esPrecioEspecial: boolean;
  subtotal: string;
}

/** Lo que devuelve generarVenta: sin costos (lo usa cualquier vendedor). */
export interface VentaGenerada {
  id: string;
  numero: number;
  /** ID visible: VAP-000123. */
  codigo: string;
  fecha: Date;
  estado: EstadoVenta;
  tipo: TipoVenta;
  /** Medio principal (el de mayor monto); null si se fió todo. */
  medioPago: MedioPago | null;
  pagos: { medioPago: MedioPago; monto: string; referencia: string | null }[];
  estadoPago: EstadoPago;
  montoPagado: string;
  saldoPendiente: string;
  deposito: { id: string; nombre: string };
  cliente: { id: string; nombre: string; telefono: string };
  /** true si el cliente se dio de alta con esta venta. */
  clienteNuevo: boolean;
  vendedorId: string;
  items: ItemVentaGenerada[];
  subtotal: string;
  descuento: string;
  total: string;
  notas: string | null;
}

const OPCIONES_GENERAR = {
  // Varios vendedores a la vez compiten por la fila de Secuencia y de Stock:
  // cada conflicto de serialización se reintenta (el número no se consume si falla).
  maxRetries: 30,
  timeout: 30_000,
};

const MEDIOS = new Set<string>(Object.values(MedioPago));
const ELEGI_MEDIO = "Elegí el medio de pago: Efectivo, Transferencia o Binance.";

/**
 * Genera una venta CONFIRMADA: valida galpón, cliente y pagos; crea el
 * cliente nuevo si hace falta (teléfono repetido → ClienteDuplicadoError con el
 * existente); toma precios y costos del servidor; descuenta stock (VENTA por
 * ítem, en orden de varianteId) y registra la auditoría. Si falta stock de
 * cualquier ítem, no se registra NADA.
 */
export async function generarVenta(
  ctx: CtxFiados,
  input: GenerarVenta,
  permisos: PermisosVenta,
  tx?: Tx,
): Promise<VentaGenerada> {
  // Con `tx` se compone en una transacción externa (convertir una cotización).
  if (tx) return medir("confirmarVenta", () => generarEnTx(tx, ctx, input, permisos));
  return medir("confirmarVenta", () =>
    transaccion(ctx, (t) => generarEnTx(t, ctx, input, permisos), OPCIONES_GENERAR),
  );
}

async function generarEnTx(
  tx: Tx,
  ctx: CtxFiados,
  input: GenerarVenta,
  permisos: PermisosVenta,
): Promise<VentaGenerada> {
  // 1. Galpón, pagos, cliente e ítems presentes.
  if (!input.depositoId) throw new DomainError("Elegí el galpón de la venta.");
  if (input.pagos.length === 0 && !input.fiar) throw new DomainError(ELEGI_MEDIO);
  if (input.pagos.some((p) => !MEDIOS.has(p.medioPago))) throw new DomainError(ELEGI_MEDIO);
  if (new Set(input.pagos.map((p) => p.medioPago)).size !== input.pagos.length)
    throw new DomainError("Usá cada medio de pago una sola vez.");
  if (!input.cliente) throw new DomainError("Elegí el cliente de la venta.");
  if (input.items.length === 0) throw new DomainError("Agregá al menos un producto.");
  const ids = input.items.map((i) => i.varianteId);
  if (new Set(ids).size !== ids.length)
    throw new DomainError("Hay productos repetidos: sumá la cantidad en una sola fila.");
  const desdeCotizacion = permisos.origen === "COTIZACION";
  if (desdeCotizacion && !permisos.cotizacionId)
    throw new DomainError("Falta la cotización de origen de la venta.");
  const puedeFijarPrecios = permisos.puedeEditar || desdeCotizacion;

  const deposito = await tx.deposito.findUnique({
    where: { id: input.depositoId },
    select: { id: true, nombre: true, activo: true },
  });
  if (!deposito) throw new NotFoundError("El galpón no existe en este panel.");
  if (!deposito.activo) throw new DomainError(`El galpón "${deposito.nombre}" está inactivo.`);

  // 2. Precios de lista y costos del servidor; permisos para precio especial y descuento.
  const variantes = await tx.variante.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      nombre: true,
      activo: true,
      productoId: true,
      precioVenta: true,
      ultimoCosto: true,
      producto: {
        select: { nombreCompleto: true, precioVenta: true, activo: true, deletedAt: true },
      },
    },
  });
  const porId = new Map(variantes.map((v) => [v.id, v]));
  const items = [...input.items]
    .sort((a, b) => (a.varianteId < b.varianteId ? -1 : a.varianteId > b.varianteId ? 1 : 0))
    .map((i) => {
      const v = porId.get(i.varianteId);
      if (!v || v.producto.deletedAt)
        throw new NotFoundError("Alguno de los productos no existe o fue dado de baja.");
      const titulo = nombreConSabor(v.producto.nombreCompleto, v.nombre);
      if (!v.activo || !v.producto.activo)
        throw new DomainError(`${titulo} está inactivo: no se puede vender.`);
      const precioLista = D(precioVentaEfectivo(v, v.producto));
      let precioUnitario = precioLista;
      if (i.precioEspecial !== undefined) {
        if (!puedeFijarPrecios)
          throw new ForbiddenError("No tenés permiso para poner precios especiales.");
        precioUnitario = r2(D(i.precioEspecial));
      }
      return {
        varianteId: v.id,
        productoId: v.productoId,
        titulo,
        cantidad: i.cantidad,
        precioLista,
        precioUnitario,
        esPrecioEspecial: !precioUnitario.equals(precioLista),
        costoUnitario: D(costoParaVenta(v)),
        subtotal: precioUnitario.mul(i.cantidad),
      };
    });

  const subtotal = items.reduce((a, i) => a.plus(i.subtotal), CERO);
  let descuento = CERO;
  if (input.descuento !== undefined && input.descuento > 0) {
    if (!puedeFijarPrecios) throw new ForbiddenError("No tenés permiso para aplicar descuentos.");
    descuento = r2(D(input.descuento));
    if (descuento.greaterThan(subtotal)) {
      throw new DomainError("El descuento no puede superar el subtotal.", "VALIDATION_ERROR", 400, {
        descuento: [`Máximo ${dec(subtotal)}`],
      });
    }
  }
  const total = subtotal.minus(descuento);
  const costoTotal = items.reduce((a, i) => a.plus(i.costoUnitario.mul(i.cantidad)), CERO);

  // 3. Stock en el galpón: se informa todo lo que falta antes de mover nada.
  const stocks = await tx.stock.findMany({
    where: { depositoId: deposito.id, varianteId: { in: ids } },
    select: { varianteId: true, cantidad: true },
  });
  const disponible = new Map(stocks.map((s) => [s.varianteId, s.cantidad]));
  const faltan = items
    .filter((i) => (disponible.get(i.varianteId) ?? 0) < i.cantidad)
    .map(
      (i) =>
        `No hay stock de ${i.titulo} en ${deposito.nombre}: hay ${disponible.get(i.varianteId) ?? 0}, se piden ${i.cantidad}`,
    );
  if (faltan.length) {
    throw new DomainError(faltan.join(" · "), "STOCK_INSUFICIENTE", 409, { stock: faltan });
  }

  // 3b. Pagos contra el total del servidor: el vuelto lo calcula la UI y no se guarda.
  const pagos = input.pagos
    .map((p) => ({
      medioPago: p.medioPago,
      monto: r2(D(p.monto)),
      referencia: p.referencia ?? null,
    }))
    .filter((p) => p.monto.greaterThan(0));
  const montoPagado = pagos.reduce((a, p) => a.plus(p.monto), CERO);
  if (montoPagado.greaterThan(total)) {
    throw new DomainError(
      `Los pagos superan el total (${dec(montoPagado)} de ${dec(total)}).`,
      "VALIDATION_ERROR",
      400,
      { pagos: [`Máximo ${dec(total)}`] },
    );
  }
  const saldoPendiente = total.minus(montoPagado);
  const fiada = saldoPendiente.greaterThan(0);
  if (fiada) {
    if (!(await puedeFiados(ctx, "crear", tx)))
      throw new ForbiddenError("No tenés permiso para vender fiado.");
    if (!input.fiar) {
      throw new DomainError(
        `El pago no cubre el total (${dec(montoPagado)} de ${dec(total)}): activá «Fiar el resto» o completá el pago.`,
      );
    }
  }
  const estadoPago = estadoPagoDe(montoPagado, saldoPendiente);
  // Medio principal: el de mayor monto (a igualdad, el primero que se cargó). Una
  // venta en $0 conserva el medio elegido aunque no genere pagos.
  const mayor = pagos.reduce<(typeof pagos)[number] | null>(
    (max, p) => (max === null || p.monto.greaterThan(max.monto) ? p : max),
    null,
  );
  const medioPrincipal =
    mayor?.medioPago ?? (total.isZero() ? (input.pagos[0]?.medioPago ?? null) : null);

  // 4. Cliente: existente del panel o alta en esta misma transacción.
  let cliente: { id: string; nombre: string; telefono: string };
  let clienteNuevo = false;
  if ("nuevo" in input.cliente) {
    cliente = await crearCliente(ctx, input.cliente.nuevo, tx);
    clienteNuevo = true;
  } else {
    const c = await tx.cliente.findFirst({
      where: { id: input.cliente.id, deletedAt: null },
      select: { id: true, nombre: true, telefono: true, activo: true },
    });
    if (!c) throw new NotFoundError("El cliente no existe o fue dado de baja.");
    if (!c.activo) throw new DomainError(`El cliente "${c.nombre}" está inactivo.`);
    cliente = { id: c.id, nombre: c.nombre, telefono: c.telefono };
  }
  // Fiada: la fila del cliente se bloquea antes de sumarle la deuda (mismo orden que los cobros).
  if (fiada) await bloquearCliente(tx, ctx, cliente.id);

  // 5. Número y código del panel (en esta transacción: si algo falla, no se consume).
  const numero = await siguienteNumero(tx, ctx.panelId, "VENTA");
  const codigo = formatearIdVenta(await slugDelPanel(tx, ctx), numero);
  const fecha = ahora();
  const venta = await tx.venta.create({
    data: {
      numero,
      codigo,
      fecha,
      clienteId: cliente.id,
      depositoId: deposito.id,
      vendedorId: ctx.usuarioId,
      tipo: input.tipo,
      estado: EstadoVenta.CONFIRMADA,
      medioPago: medioPrincipal,
      estadoPago,
      montoPagado,
      saldoPendiente,
      subtotal,
      descuento,
      total,
      costoTotal,
      gananciaBruta: total.minus(costoTotal),
      notas: input.notas ?? null,
      cotizacionId: desdeCotizacion ? permisos.cotizacionId : null,
      items: {
        create: items.map((i) => ({
          varianteId: i.varianteId,
          productoId: i.productoId,
          cantidad: i.cantidad,
          precioLista: i.precioLista,
          precioUnitario: i.precioUnitario,
          esPrecioEspecial: i.esPrecioEspecial,
          costoUnitario: i.costoUnitario,
          subtotal: i.subtotal,
        })),
      },
      pagos: {
        create: pagos.map((p) => ({
          medioPago: p.medioPago,
          monto: p.monto,
          referencia: p.referencia,
          fecha,
          usuarioId: ctx.usuarioId,
        })),
      },
    },
    select: { id: true, fecha: true },
  });
  if (fiada) {
    await tx.cliente.update({
      where: { id: cliente.id },
      data: { saldoDeudor: { increment: saldoPendiente } },
    });
  }

  // 6. Stock: un VENTA por ítem, en orden de varianteId (sin deadlocks entre vendedores).
  for (const i of items) {
    await registrarMovimiento(tx, {
      tipo: TipoMovimiento.VENTA,
      varianteId: i.varianteId,
      depositoId: deposito.id,
      cantidad: i.cantidad,
      costoUnitario: i.costoUnitario,
      motivo: `Venta ${codigo}`,
      referenciaTipo: "VENTA",
      referenciaId: venta.id,
      usuarioId: ctx.usuarioId,
    });
  }

  await registrarAuditoria(tx, {
    usuarioId: ctx.usuarioId,
    accion: AccionAuditoria.CREATE,
    entidad: "Venta",
    entidadId: venta.id,
    datosDespues: {
      codigo,
      estado: EstadoVenta.CONFIRMADA,
      depositoId: deposito.id,
      clienteId: cliente.id,
      clienteNuevo,
      medioPago: medioPrincipal,
      pagos: pagos.map((p) => ({
        medioPago: p.medioPago,
        monto: dec(p.monto),
        ...(p.referencia ? { referencia: p.referencia } : {}),
      })),
      estadoPago,
      montoPagado: dec(montoPagado),
      saldoPendiente: dec(saldoPendiente),
      tipo: input.tipo,
      ...(desdeCotizacion ? { cotizacionId: permisos.cotizacionId } : {}),
      subtotal: dec(subtotal),
      descuento: dec(descuento),
      total: dec(total),
      costoTotal: dec(costoTotal),
      items: items.map((i) => ({
        varianteId: i.varianteId,
        cantidad: i.cantidad,
        precioLista: dec(i.precioLista),
        precioUnitario: dec(i.precioUnitario),
      })),
    },
    meta: ctx.meta,
  });

  return {
    id: venta.id,
    numero,
    codigo,
    fecha: venta.fecha,
    estado: EstadoVenta.CONFIRMADA,
    tipo: input.tipo,
    medioPago: medioPrincipal,
    pagos: pagos.map((p) => ({
      medioPago: p.medioPago,
      monto: dec(p.monto),
      referencia: p.referencia,
    })),
    estadoPago,
    montoPagado: dec(montoPagado),
    saldoPendiente: dec(saldoPendiente),
    deposito: { id: deposito.id, nombre: deposito.nombre },
    cliente,
    clienteNuevo,
    vendedorId: ctx.usuarioId,
    items: items.map((i) => ({
      varianteId: i.varianteId,
      productoId: i.productoId,
      titulo: i.titulo,
      cantidad: i.cantidad,
      precioLista: dec(i.precioLista),
      precioUnitario: dec(i.precioUnitario),
      esPrecioEspecial: i.esPrecioEspecial,
      subtotal: dec(i.subtotal),
    })),
    subtotal: dec(subtotal),
    descuento: dec(descuento),
    total: dec(total),
    notas: input.notas ?? null,
  };
}

// =============================================================================
// Anulación (solo OWNER)
// =============================================================================

/**
 * Anula una venta CONFIRMADA: la mercadería vuelve a su galpón (VENTA_ANULADA
 * por ítem), sus pagos quedan anulados y, si estaba fiada, su saldo pendiente
 * se descuenta de la deuda del cliente. No se puede si tiene devoluciones
 * registradas.
 */
export async function anularVenta(
  ctx: Ctx,
  id: string,
  motivo: string,
): Promise<{ id: string; codigo: string }> {
  const m = motivo.trim();
  if (!m) throw new DomainError("Contá por qué se anula la venta.");
  return transaccion(
    ctx,
    async (tx) => {
      const usuario = await tx.usuario.findUnique({
        where: { id: ctx.usuarioId },
        select: { rol: true },
      });
      if (usuario?.rol !== RolUsuario.OWNER)
        throw new ForbiddenError("Solo un dueño puede anular ventas.");
      // Cliente antes que la venta: mismo orden de bloqueo que los cobros de fiados.
      const previa = await tx.venta.findUnique({ where: { id }, select: { clienteId: true } });
      if (!previa) throw new NotFoundError("La venta no existe");
      await bloquearCliente(tx, ctx, previa.clienteId);
      await tx.$queryRaw`
        SELECT "id" FROM "Venta" WHERE "id" = ${id} AND "panelId" = ${ctx.panelId} FOR UPDATE
      `;
      const venta = await tx.venta.findUnique({
        where: { id },
        include: { items: { orderBy: { varianteId: "asc" } } },
      });
      if (!venta) throw new NotFoundError("La venta no existe");
      if (venta.estado !== EstadoVenta.CONFIRMADA)
        throw new DomainError(`La venta ${venta.codigo} ya está anulada.`);
      const devoluciones = await tx.devolucion.count({
        where: { ventaId: id, estado: EstadoDevolucion.REGISTRADA },
      });
      if (devoluciones > 0) {
        throw new DomainError(
          `La venta ${venta.codigo} tiene devoluciones registradas: anulalas primero.`,
        );
      }
      for (const item of venta.items) {
        await registrarMovimiento(tx, {
          tipo: TipoMovimiento.VENTA_ANULADA,
          varianteId: item.varianteId,
          depositoId: venta.depositoId,
          cantidad: item.cantidad,
          costoUnitario: item.costoUnitario,
          motivo: `Anulación venta ${venta.codigo}: ${m}`,
          referenciaTipo: "VENTA",
          referenciaId: venta.id,
          usuarioId: ctx.usuarioId,
        });
      }
      // Pagos: todos anulados (los del momento y los cobros posteriores).
      const cuando = ahora();
      const pagos = await tx.pagoVenta.updateMany({
        where: { ventaId: id, anulado: false },
        data: {
          anulado: true,
          anuladoPorId: ctx.usuarioId,
          anuladoAt: cuando,
          motivoAnulacion: `Anulación venta ${venta.codigo}: ${m}`,
        },
      });
      await tx.venta.update({
        where: { id },
        data: {
          estado: EstadoVenta.ANULADA,
          anuladaPorId: ctx.usuarioId,
          anuladaAt: cuando,
          motivoAnulacion: m,
          montoPagado: 0,
          saldoPendiente: 0,
        },
      });
      if (venta.saldoPendiente.greaterThan(0)) {
        await tx.cliente.update({
          where: { id: venta.clienteId },
          data: { saldoDeudor: { decrement: venta.saldoPendiente } },
        });
      }
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Venta",
        entidadId: id,
        datosAntes: {
          estado: EstadoVenta.CONFIRMADA,
          total: dec(venta.total),
          estadoPago: venta.estadoPago,
          montoPagado: dec(venta.montoPagado),
          saldoPendiente: dec(venta.saldoPendiente),
        },
        datosDespues: {
          estado: EstadoVenta.ANULADA,
          codigo: venta.codigo,
          motivo: m,
          pagosAnulados: pagos.count,
          ...(venta.saldoPendiente.greaterThan(0)
            ? { saldoDeudorDescontado: dec(venta.saldoPendiente) }
            : {}),
        },
        meta: ctx.meta,
      });
      return { id, codigo: venta.codigo };
    },
    { maxRetries: 5, timeout: 30_000 },
  );
}

// =============================================================================
// Lectura
// =============================================================================

function whereVentas(f: Omit<FiltrosVentas, "page" | "pageSize">): Prisma.VentaWhereInput {
  const where: Prisma.VentaWhereInput = {};
  if (f.estado) where.estado = f.estado;
  if (f.depositoId) where.depositoId = f.depositoId;
  if (f.clienteId) where.clienteId = f.clienteId;
  if (f.vendedorId) where.vendedorId = f.vendedorId;
  // Medio de pago: ventas con algún pago en ese medio (mixtas incluidas).
  if (f.medioPago) where.pagos = { some: { medioPago: f.medioPago } };
  if (f.tipo) where.tipo = f.tipo;
  if (f.desde || f.hasta) {
    where.fecha = {
      ...(f.desde ? { gte: inicioDelDia(f.desde) } : {}),
      ...(f.hasta ? { lte: finDelDia(f.hasta) } : {}),
    };
  }
  const q = f.q?.trim().replace(/^#/, "");
  if (q) {
    // "VAP-000123", "vap-123" o "123": ID de venta; si no, nombre o teléfono del cliente.
    const numero = numeroDeIdVenta(q);
    const digitos = q.replace(/\D/g, "").replace(/^0+/, "");
    const or: Prisma.VentaWhereInput[] = [
      { codigo: { contains: q, mode: "insensitive" } },
      { cliente: { nombre: { contains: q, mode: "insensitive" } } },
    ];
    if (numero !== null) or.push({ numero });
    if (digitos.length >= 4) or.push({ cliente: { telefono: { contains: digitos } } });
    where.OR = or;
  }
  return where;
}

export interface VentaListada {
  id: string;
  codigo: string;
  fecha: Date;
  estado: EstadoVenta;
  tipo: TipoVenta;
  cliente: { id: string; nombre: string; telefono: string };
  vendedor: string;
  deposito: string;
  items: number;
  unidades: number;
  total: string;
  /** Medio principal; null si se fió todo. */
  medioPago: MedioPago | null;
  estadoPago: EstadoPago;
  saldoPendiente: string;
  /** null si el usuario no es OWNER. */
  gananciaBruta: string | null;
}

export interface ListadoVentas {
  ventas: VentaListada[];
  total: number;
  page: number;
  pageSize: number;
  /** Totales del período (solo ventas confirmadas). */
  resumen: { cantidad: number; total: string; gananciaBruta: string | null };
}

export async function listarVentas(
  ctx: Ctx,
  f: FiltrosVentas,
  opciones: OpcionesLectura,
): Promise<ListadoVentas> {
  const db = dbPara(ctx.panelId);
  const where = whereVentas(f);
  const [total, filas, agregado] = await Promise.all([
    db.venta.count({ where }),
    db.venta.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        cliente: { select: { id: true, nombre: true, telefono: true } },
        vendedor: { select: { nombre: true } },
        deposito: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
    db.venta.aggregate({
      where: { AND: [where, { estado: EstadoVenta.CONFIRMADA }] },
      _count: true,
      _sum: { total: true, gananciaBruta: true },
    }),
  ]);
  return {
    ventas: filas.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      estado: v.estado,
      tipo: v.tipo,
      cliente: v.cliente,
      vendedor: v.vendedor.nombre,
      deposito: v.deposito.nombre,
      items: v.items.length,
      unidades: v.items.reduce((a, i) => a + i.cantidad, 0),
      total: dec(v.total),
      medioPago: v.medioPago,
      estadoPago: v.estadoPago,
      saldoPendiente: dec(v.saldoPendiente),
      gananciaBruta: opciones.verCostos ? dec(v.gananciaBruta) : null,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
    resumen: {
      cantidad: agregado._count,
      total: dec(agregado._sum.total ?? CERO),
      gananciaBruta: opciones.verCostos ? dec(agregado._sum.gananciaBruta ?? CERO) : null,
    },
  };
}

/** Usuarios que vendieron en el panel (filtro "Vendedor" del listado). */
export async function vendedoresDelPanel(ctx: Ctx): Promise<{ id: string; nombre: string }[]> {
  const db = dbPara(ctx.panelId);
  const grupos = await db.venta.groupBy({ by: ["vendedorId"] });
  if (grupos.length === 0) return [];
  return db.usuario.findMany({
    where: { id: { in: grupos.map((g) => g.vendedorId) } },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
}

export async function obtenerVenta(ctx: Ctx, id: string, opciones: OpcionesLectura) {
  const db = dbPara(ctx.panelId);
  const v = await db.venta.findUnique({
    where: { id },
    include: {
      cliente: { select: { id: true, nombre: true, telefono: true } },
      vendedor: { select: { id: true, nombre: true } },
      anuladaPor: { select: { nombre: true } },
      deposito: { select: { id: true, nombre: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variante: {
            select: { nombre: true, sku: true, producto: { select: { nombreCompleto: true } } },
          },
        },
      },
      devoluciones: {
        orderBy: { fecha: "desc" },
        select: { id: true, codigo: true, fecha: true, estado: true },
      },
      pagos: {
        orderBy: [{ fecha: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          medioPago: true,
          monto: true,
          referencia: true,
          esCobroPosterior: true,
          fecha: true,
          anulado: true,
          usuario: { select: { nombre: true } },
        },
      },
    },
  });
  if (!v) throw new NotFoundError("La venta no existe");
  const movimientos = await db.movimientoStock.findMany({
    where: { referenciaTipo: "VENTA", referenciaId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tipo: true,
      cantidad: true,
      stockAnterior: true,
      stockPosterior: true,
      createdAt: true,
      deposito: { select: { nombre: true } },
      variante: { select: { nombre: true, producto: { select: { nombreCompleto: true } } } },
    },
  });
  const costos = opciones.verCostos;
  return {
    id: v.id,
    numero: v.numero,
    codigo: v.codigo,
    fecha: v.fecha,
    estado: v.estado,
    tipo: v.tipo,
    medioPago: v.medioPago,
    estadoPago: v.estadoPago,
    montoPagado: dec(v.montoPagado),
    saldoPendiente: dec(v.saldoPendiente),
    pagos: v.pagos.map((p) => ({
      id: p.id,
      medioPago: p.medioPago,
      monto: dec(p.monto),
      referencia: p.referencia,
      esCobroPosterior: p.esCobroPosterior,
      fecha: p.fecha,
      anulado: p.anulado,
      usuario: p.usuario.nombre,
    })),
    cliente: v.cliente,
    vendedor: v.vendedor,
    deposito: v.deposito,
    subtotal: dec(v.subtotal),
    descuento: dec(v.descuento),
    total: dec(v.total),
    costoTotal: costos ? dec(v.costoTotal) : null,
    gananciaBruta: costos ? dec(v.gananciaBruta) : null,
    notas: v.notas,
    anulacion: v.anuladaAt
      ? { por: v.anuladaPor?.nombre ?? "", at: v.anuladaAt, motivo: v.motivoAnulacion }
      : null,
    devoluciones: v.devoluciones,
    tieneDevolucionesRegistradas: v.devoluciones.some(
      (d) => d.estado === EstadoDevolucion.REGISTRADA,
    ),
    items: v.items.map((i) => ({
      id: i.id,
      varianteId: i.varianteId,
      productoId: i.productoId,
      titulo: nombreConSabor(i.variante.producto.nombreCompleto, i.variante.nombre),
      producto: i.variante.producto.nombreCompleto,
      sabor: saborVisible(i.variante.nombre),
      sku: i.variante.sku,
      cantidad: i.cantidad,
      precioLista: dec(i.precioLista),
      precioUnitario: dec(i.precioUnitario),
      esPrecioEspecial: i.esPrecioEspecial,
      costoUnitario: costos ? dec(i.costoUnitario) : null,
      subtotal: dec(i.subtotal),
    })),
    movimientos: movimientos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      titulo: nombreConSabor(m.variante.producto.nombreCompleto, m.variante.nombre),
      deposito: m.deposito.nombre,
      cantidad: m.cantidad,
      stockAnterior: m.stockAnterior,
      stockPosterior: m.stockPosterior,
      createdAt: m.createdAt,
    })),
  };
}

export type VentaDetalle = Awaited<ReturnType<typeof obtenerVenta>>;

/**
 * Ventas confirmadas de un cliente, más nuevas primero (el modal de
 * devoluciones las ofrece para "vincular a una venta").
 */
export async function ventasDeCliente(
  ctx: Ctx,
  clienteId: string,
  limite = 20,
): Promise<
  {
    id: string;
    codigo: string;
    fecha: Date;
    total: string;
    items: { varianteId: string; productoId: string; titulo: string; cantidad: number }[];
  }[]
> {
  const db = dbPara(ctx.panelId);
  const ventas = await db.venta.findMany({
    where: { clienteId, estado: EstadoVenta.CONFIRMADA },
    orderBy: [{ fecha: "desc" }, { numero: "desc" }],
    take: Math.min(Math.max(limite, 1), 100),
    select: {
      id: true,
      codigo: true,
      fecha: true,
      total: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          varianteId: true,
          productoId: true,
          cantidad: true,
          variante: { select: { nombre: true, producto: { select: { nombreCompleto: true } } } },
        },
      },
    },
  });
  return ventas.map((v) => ({
    id: v.id,
    codigo: v.codigo,
    fecha: v.fecha,
    total: dec(v.total),
    items: v.items.map((i) => ({
      varianteId: i.varianteId,
      productoId: i.productoId,
      titulo: nombreConSabor(i.variante.producto.nombreCompleto, i.variante.nombre),
      cantidad: i.cantidad,
    })),
  }));
}

/** Unidades totales por galpón activo del panel (cards del paso 1 del modal). */
export async function unidadesPorDeposito(ctx: Ctx): Promise<Record<string, number>> {
  const grupos = await dbPara(ctx.panelId).stock.groupBy({
    by: ["depositoId"],
    where: { deposito: { activo: true } },
    _sum: { cantidad: true },
  });
  return Object.fromEntries(grupos.map((g) => [g.depositoId, g._sum.cantidad ?? 0]));
}

/** Stock actual de unos sabores en un galpón (el modal lo refresca antes de avanzar). */
export async function stockEnDeposito(
  ctx: Ctx,
  depositoId: string,
  varianteIds: string[],
): Promise<Record<string, number>> {
  if (varianteIds.length === 0) return {};
  const filas = await dbPara(ctx.panelId).stock.findMany({
    where: { depositoId, varianteId: { in: varianteIds } },
    select: { varianteId: true, cantidad: true },
  });
  const r: Record<string, number> = Object.fromEntries(varianteIds.map((id) => [id, 0]));
  for (const f of filas) r[f.varianteId] = f.cantidad;
  return r;
}

export interface ProductoMasVendido {
  varianteId: string;
  productoId: string;
  titulo: string;
  nombreCompleto: string;
  sabor: string | null;
  precioVenta: string;
  /** Stock en el galpón pedido (0 si no se pidió). */
  stock: number;
  /** Unidades vendidas en el período. */
  vendidas: number;
}

/**
 * `fecha` es timestamp SIN zona (UTC) y la sesión de Postgres está en hora
 * argentina: un Date como parámetro (timestamptz) se compararía corrido 3 h.
 */
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * Los sabores más vendidos del panel en los últimos `dias` (grilla del modal).
 * Si todavía no hay suficientes ventas, completa con los de más stock en el galpón.
 */
export async function productosMasVendidos(
  ctx: Ctx,
  opciones: { dias?: number; limit?: number; depositoId?: string } = {},
): Promise<ProductoMasVendido[]> {
  const { dias = 30, limit = 12, depositoId } = opciones;
  const db = dbPara(ctx.panelId);
  const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);
  const vendidos = await db.$queryRaw<{ varianteId: string; vendidas: bigint }[]>`
    SELECT vi."varianteId", SUM(vi."cantidad") AS vendidas
    FROM "VentaItem" vi
    JOIN "Venta" v ON v."id" = vi."ventaId"
    JOIN "Variante" va ON va."id" = vi."varianteId"
    JOIN "Producto" p ON p."id" = va."productoId"
    WHERE vi."panelId" = ${ctx.panelId} AND v."panelId" = ${ctx.panelId}
      AND v."estado" = 'CONFIRMADA' AND v."fecha" >= ${utc(desde)}
      AND va."deletedAt" IS NULL AND va."activo" AND p."deletedAt" IS NULL AND p."activo"
    GROUP BY vi."varianteId" ORDER BY vendidas DESC, vi."varianteId" LIMIT ${limit}
  `;
  const conteo = new Map(vendidos.map((v) => [v.varianteId, Number(v.vendidas)]));
  const ids = vendidos.map((v) => v.varianteId);
  if (ids.length < limit && depositoId) {
    const extra = await db.$queryRaw<{ varianteId: string }[]>`
      SELECT s."varianteId" FROM "Stock" s
      JOIN "Variante" va ON va."id" = s."varianteId"
      JOIN "Producto" p ON p."id" = va."productoId"
      WHERE s."panelId" = ${ctx.panelId} AND s."depositoId" = ${depositoId} AND s."cantidad" > 0
        AND va."deletedAt" IS NULL AND va."activo" AND p."deletedAt" IS NULL AND p."activo"
      ORDER BY s."cantidad" DESC, s."varianteId" LIMIT ${limit * 2}
    `;
    for (const e of extra)
      if (ids.length < limit && !ids.includes(e.varianteId)) ids.push(e.varianteId);
  }
  if (ids.length === 0) return [];
  const variantes = await db.variante.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      nombre: true,
      productoId: true,
      precioVenta: true,
      producto: { select: { nombreCompleto: true, precioVenta: true } },
      stocks: depositoId
        ? { where: { depositoId }, select: { cantidad: true } }
        : { take: 0, select: { cantidad: true } },
    },
  });
  const orden = new Map(ids.map((id, i) => [id, i]));
  return variantes
    .sort((a, b) => (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0))
    .map((v) => ({
      varianteId: v.id,
      productoId: v.productoId,
      titulo: nombreConSabor(v.producto.nombreCompleto, v.nombre),
      nombreCompleto: v.producto.nombreCompleto,
      sabor: saborVisible(v.nombre),
      precioVenta: precioVentaEfectivo(v, v.producto),
      stock: v.stocks[0]?.cantidad ?? 0,
      vendidas: conteo.get(v.id) ?? 0,
    }));
}
