import {
  AccionAuditoria,
  EstadoVenta,
  Prisma,
  TipoMovimiento,
  type MedioPago,
} from "@prisma/client";

import { finDelDia, inicioDelDia } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { formatearIdVenta, numeroDeIdVenta } from "@/lib/paneles";
import { costoParaVenta, precioVentaEfectivo, tienePrecioPropio } from "@/lib/precios";
import { ahora } from "@/lib/reloj";
import type { BorradorVenta, FiltrosVentas, RedondeoVenta, Vender } from "@/lib/validations/venta";
import { nombreConSabor, saborVisible } from "@/lib/ventas-ui";
import { dbPara, enTransaccion, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { siguienteNumero } from "@/server/db/secuencia";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { medir } from "@/server/log";
import { registrarAuditoria } from "@/server/services/audit.service";
import { registrarMovimiento } from "@/server/services/stock.service";

/**
 * VENTAS (por panel)
 * - Precios, costos y totales se calculan SIEMPRE acá. El cliente manda ids,
 *   cantidades y el medio de pago.
 * - La venta se cobra COMPLETA en el momento con UN solo medio de pago: no hay
 *   pagos partidos, fiado ni saldos (la DB exige medioPago al confirmar).
 * - Confirmar: una transacción Serializable (con reintentos) que descuenta
 *   stock (VENTA por ítem) y congela el costo. Todo o nada.
 * - `numero` es correlativo por panel (tabla Secuencia) y se toma en la misma
 *   transacción que crea la venta. El ID visible es formatearIdVenta(slug, numero).
 * - Precio: el efectivo del sabor (el propio o, si no tiene, el del producto).
 * - Costo: snapshot de Variante.ultimoCosto al confirmar (0 si el sabor todavía
 *   no tuvo compras): la ganancia histórica no cambia con compras posteriores.
 * - Costos y ganancia: solo los ve el OWNER (`verCostos`); a un empleado no le llegan.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const CERO = D(0);
const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const dec = (d: Prisma.Decimal) => d.toFixed(2);
const $ = (d: Prisma.Decimal) => formatearPesos(d.toFixed(2));
const nombreCliente = (c: { nombre: string; apellido: string | null }) =>
  [c.nombre, c.apellido].filter(Boolean).join(" ");

export interface PermisosVenta {
  /** VENTAS "editar": precio manual y descuento global. */
  puedeEditar: boolean;
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

/** Bloquea (FOR UPDATE) la venta del panel y la devuelve con sus ítems. */
async function bloquearVenta(tx: Tx, ctx: Ctx, ventaId: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "Venta" WHERE "id" = ${ventaId} AND "panelId" = ${ctx.panelId} FOR UPDATE
  `;
  const venta = await tx.venta.findUnique({
    where: { id: ventaId },
    include: {
      deposito: { select: { nombre: true, activo: true } },
      items: {
        orderBy: { varianteId: "asc" },
        include: {
          variante: {
            select: {
              nombre: true,
              ultimoCosto: true,
              producto: { select: { nombreCompleto: true } },
            },
          },
        },
      },
    },
  });
  if (!venta) throw new NotFoundError("La venta no existe");
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
async function calcularBorrador(tx: Tx, ctx: Ctx, datos: BorradorVenta, permisos: PermisosVenta) {
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
        ultimoCosto: true,
        producto: {
          select: { nombreCompleto: true, precioVenta: true, activo: true, deletedAt: true },
        },
      },
    }),
    tx.usuario.findUniqueOrThrow({ where: { id: ctx.usuarioId }, select: { nombre: true } }),
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
    const nombre = nombreConSabor(v.producto.nombreCompleto, v.nombre);
    if (!v.activo || !v.producto.activo)
      throw new DomainError(`${nombre} está inactivo: no se puede vender`);
    const lista = D(precioVentaEfectivo(v, v.producto));
    let precio = lista;
    let notas: string | null = null;
    if (i.precioUnitario !== undefined && !D(i.precioUnitario).equals(lista)) {
      if (!permisos.puedeEditar)
        throw new ForbiddenError("No tenés permiso para cambiar precios en la venta.");
      precio = r2(D(i.precioUnitario));
      notas = `Precio modificado por ${usuario.nombre} de ${$(lista)} a ${$(precio)}`;
    }
    return {
      varianteId: v.id,
      cantidad: i.cantidad,
      precioUnitario: precio,
      costoUnitario: D(costoParaVenta(v)), // provisorio: al confirmar se toma el costo del momento
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
  ctx: Ctx,
  datos: BorradorVenta,
  permisos: PermisosVenta,
  tx?: Tx,
): Promise<{ id: string; numero: number; idVenta: string }> {
  return enTransaccion(ctx, tx, async (t) => {
    const c = await calcularBorrador(t, ctx, datos, permisos);
    const numero = await siguienteNumero(t, ctx.panelId, "VENTA");
    const venta = await t.venta.create({
      data: {
        numero,
        depositoId: datos.depositoId,
        clienteId: datos.clienteId ?? null,
        estado: EstadoVenta.BORRADOR,
        subtotal: c.subtotal,
        descuento: c.descuento,
        total: c.total,
        costoTotal: c.costoTotal,
        gananciaBruta: c.total.minus(c.costoTotal),
        notas: datos.notas ?? null,
        usuarioId: ctx.usuarioId,
        items: { create: c.items },
      },
    });
    await registrarAuditoria(t, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "Venta",
      entidadId: venta.id,
      datosDespues: { numero, estado: "BORRADOR", total: dec(c.total), items: c.items.length },
      meta: ctx.meta,
    });
    return { id: venta.id, numero, idVenta: formatearIdVenta(await slugDelPanel(t, ctx), numero) };
  });
}

/** Reemplaza datos e ítems de un BORRADOR (conserva su número). */
export async function actualizarBorrador(
  ctx: Ctx,
  id: string,
  datos: BorradorVenta,
  permisos: PermisosVenta,
  tx?: Tx,
): Promise<{ id: string; numero: number; idVenta: string }> {
  return enTransaccion(ctx, tx, async (t) => {
    const antes = await bloquearVenta(t, ctx, id);
    const idVenta = formatearIdVenta(await slugDelPanel(t, ctx), antes.numero);
    if (antes.estado !== EstadoVenta.BORRADOR) {
      throw new DomainError(
        `La venta ${idVenta} ya está ${antes.estado.toLowerCase()}: no se edita.`,
      );
    }
    const c = await calcularBorrador(t, ctx, datos, permisos);
    await t.ventaItem.deleteMany({ where: { ventaId: id } });
    await t.venta.update({
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
    await registrarAuditoria(t, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Venta",
      entidadId: id,
      datosAntes: { total: dec(antes.total) },
      datosDespues: { total: dec(c.total), items: c.items.length },
      meta: ctx.meta,
    });
    return { id, numero: antes.numero, idVenta };
  });
}

/** Descarta un borrador (no movió stock: se borra; su número queda sin usar). */
export async function descartarBorrador(ctx: Ctx, id: string): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const v = await bloquearVenta(tx, ctx, id);
    if (v.estado !== EstadoVenta.BORRADOR) {
      const idVenta = formatearIdVenta(await slugDelPanel(tx, ctx), v.numero);
      throw new DomainError(`La venta ${idVenta} no es un borrador: anulala.`);
    }
    await tx.venta.delete({ where: { id } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.DELETE,
      entidad: "Venta",
      entidadId: id,
      datosAntes: { numero: v.numero, estado: "BORRADOR", total: dec(v.total) },
      meta: ctx.meta,
    });
  });
}

// =============================================================================
// Confirmación (la función crítica)
// =============================================================================

export interface VentaConfirmada {
  id: string;
  numero: number;
  /** ID visible: VAP-000123. */
  idVenta: string;
  total: string;
  medioPago: MedioPago;
}

interface OpcionesCobro {
  medioPago: MedioPago;
  redondearA?: RedondeoVenta | number;
}

const OPCIONES_CONFIRMAR = {
  maxRetries: 10, // varias cajas cobrando a la vez el mismo producto: cada conflicto se reintenta
  timeout: 30_000,
};

/** Confirma un BORRADOR ya guardado (descuenta stock y registra el cobro). */
export async function confirmarVenta(
  ctx: Ctx,
  id: string,
  opciones: OpcionesCobro,
): Promise<VentaConfirmada> {
  return medir("confirmarVenta", () =>
    transaccion(ctx, (tx) => confirmarEnTx(tx, ctx, id, opciones), OPCIONES_CONFIRMAR),
  );
}

/**
 * Cuerpo de la confirmación, dentro de una transacción del panel: descuenta
 * stock, congela costos y cobra el total con un único medio de pago.
 * Los precios son los del borrador (lo que vio el vendedor es lo que se cobra).
 */
async function confirmarEnTx(
  tx: Tx,
  ctx: Ctx,
  id: string,
  opciones: OpcionesCobro,
): Promise<VentaConfirmada> {
  // 1. Bloqueo y estado.
  const venta = await bloquearVenta(tx, ctx, id);
  const idVenta = formatearIdVenta(await slugDelPanel(tx, ctx), venta.numero);
  if (venta.estado !== EstadoVenta.BORRADOR) {
    throw new DomainError(`La venta ${idVenta} ya está ${venta.estado.toLowerCase()}.`);
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

  // 3. Stock: primero se informa todo lo que falta; después, un VENTA por ítem (todo o nada).
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
      const n = nombreConSabor(i.variante.producto.nombreCompleto, i.variante.nombre);
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
      costoUnitario: D(costoParaVenta(item.variante)),
      motivo: `Venta ${idVenta}`,
      referenciaTipo: "VENTA",
      referenciaId: venta.id,
      usuarioId: ctx.usuarioId,
    });
  }

  // 4. Snapshot de costos (el de ahora, no el del borrador): la ganancia histórica queda fija.
  let costoTotal = CERO;
  for (const item of venta.items) {
    const costo = D(costoParaVenta(item.variante));
    costoTotal = costoTotal.plus(costo.mul(item.cantidad));
    if (!costo.equals(item.costoUnitario)) {
      await tx.ventaItem.update({ where: { id: item.id }, data: { costoUnitario: costo } });
    }
  }

  // 5. Confirmada y cobrada, con la fecha de ahora (no la del borrador).
  await tx.venta.update({
    where: { id },
    data: {
      estado: EstadoVenta.CONFIRMADA,
      fecha: ahora(),
      subtotal,
      redondeo,
      total,
      costoTotal,
      gananciaBruta: total.minus(costoTotal),
      medioPago: opciones.medioPago,
    },
  });

  // 6. Auditoría.
  await registrarAuditoria(tx, {
    usuarioId: ctx.usuarioId,
    accion: AccionAuditoria.UPDATE,
    entidad: "Venta",
    entidadId: id,
    datosAntes: { estado: "BORRADOR" },
    datosDespues: {
      estado: "CONFIRMADA",
      idVenta,
      total: dec(total),
      redondeo: dec(redondeo),
      costoTotal: dec(costoTotal),
      medioPago: opciones.medioPago,
    },
    meta: ctx.meta,
  });

  return { id, numero: venta.numero, idVenta, total: dec(total), medioPago: opciones.medioPago };
}

/** POS: guarda (crea o actualiza) el borrador y lo confirma en la misma transacción. */
export async function vender(
  ctx: Ctx,
  datos: Vender,
  permisos: PermisosVenta,
): Promise<VentaConfirmada> {
  return medir("confirmarVenta", () =>
    transaccion(
      ctx,
      async (tx) => {
        const { id } = datos.borradorId
          ? await actualizarBorrador(ctx, datos.borradorId, datos.venta, permisos, tx)
          : await crearBorrador(ctx, datos.venta, permisos, tx);
        return confirmarEnTx(tx, ctx, id, {
          medioPago: datos.medioPago,
          redondearA: datos.redondearA,
        });
      },
      OPCIONES_CONFIRMAR,
    ),
  );
}

// =============================================================================
// Anulación
// =============================================================================

/** Anula una venta CONFIRMADA: la mercadería vuelve a su depósito (DEVOLUCION_CLIENTE por ítem). */
export async function anularVenta(
  ctx: Ctx,
  id: string,
  motivo: string,
): Promise<{ numero: number; idVenta: string }> {
  return transaccion(
    ctx,
    async (tx) => {
      const venta = await bloquearVenta(tx, ctx, id);
      const idVenta = formatearIdVenta(await slugDelPanel(tx, ctx), venta.numero);
      if (venta.estado !== EstadoVenta.CONFIRMADA)
        throw new DomainError(`La venta ${idVenta} está ${venta.estado.toLowerCase()}.`);
      if ((await tx.devolucion.count({ where: { ventaId: id } })) > 0) {
        throw new DomainError(`La venta ${idVenta} tiene devoluciones: no se puede anular.`);
      }
      for (const item of venta.items) {
        await registrarMovimiento(tx, {
          tipo: TipoMovimiento.DEVOLUCION_CLIENTE,
          varianteId: item.varianteId,
          depositoId: venta.depositoId,
          cantidad: item.cantidad,
          costoUnitario: item.costoUnitario,
          motivo: `Anulación venta ${idVenta}: ${motivo}`,
          referenciaTipo: "VENTA",
          referenciaId: venta.id,
          usuarioId: ctx.usuarioId,
        });
      }
      await tx.venta.update({
        where: { id },
        data: {
          estado: EstadoVenta.ANULADA,
          anuladaPorId: ctx.usuarioId,
          anuladaAt: ahora(),
          motivoAnulacion: motivo,
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Venta",
        entidadId: id,
        datosAntes: { estado: "CONFIRMADA", total: dec(venta.total), medioPago: venta.medioPago },
        datosDespues: { estado: "ANULADA", idVenta, motivo },
        meta: ctx.meta,
      });
      return { numero: venta.numero, idVenta };
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
  if (f.depositoId) where.depositoId = f.depositoId;
  if (f.clienteId) where.clienteId = f.clienteId;
  if (f.usuarioId) where.usuarioId = f.usuarioId;
  if (f.medioPago) where.medioPago = f.medioPago;
  if (f.desde || f.hasta) {
    where.fecha = {
      ...(f.desde ? { gte: inicioDelDia(f.desde) } : {}),
      ...(f.hasta ? { lte: finDelDia(f.hasta) } : {}),
    };
  }
  const q = f.q?.trim().replace(/^#/, "");
  if (q) {
    // "VAP-000123", "vap-123" o "123": ID de venta (o un DNI/teléfono del cliente).
    const numero = numeroDeIdVenta(q);
    const digitos = q.replace(/\D/g, "");
    where.OR =
      numero !== null
        ? [
            { numero },
            ...(/^\d+$/.test(q) && digitos.length >= 3
              ? [
                  { cliente: { documento: { contains: digitos } } },
                  { cliente: { telefono: { contains: digitos } } },
                ]
              : []),
          ]
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
  cliente: string | null;
  vendedor: string;
  deposito: string;
  items: number;
  unidades: number;
  total: string;
  medioPago: MedioPago | null;
  /** null si el usuario no es OWNER. */
  gananciaBruta: string | null;
}

export async function listarVentas(
  ctx: Ctx,
  f: FiltrosVentas,
  opciones: OpcionesLectura,
): Promise<{
  ventas: VentaListada[];
  total: number;
  page: number;
  pageSize: number;
  resumen: { cantidad: number; total: string; gananciaBruta: string | null };
}> {
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
        cliente: { select: { nombre: true, apellido: true } },
        usuario: { select: { nombre: true } },
        deposito: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
    // Totales del rango: solo lo vendido de verdad (confirmadas).
    db.venta.aggregate({
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
      cliente: v.cliente ? nombreCliente(v.cliente) : null,
      vendedor: v.usuario.nombre,
      deposito: v.deposito.nombre,
      items: v.items.length,
      unidades: v.items.reduce((a, i) => a + i.cantidad, 0),
      total: dec(v.total),
      medioPago: v.medioPago,
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
  const grupos = await db.venta.groupBy({ by: ["usuarioId"] });
  if (grupos.length === 0) return [];
  return db.usuario.findMany({
    where: { id: { in: grupos.map((g) => g.usuarioId) } },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
}

export async function obtenerVenta(ctx: Ctx, id: string, opciones: OpcionesLectura) {
  const db = dbPara(ctx.panelId);
  const v = await db.venta.findUnique({
    where: { id },
    include: {
      cliente: {
        select: { id: true, nombre: true, apellido: true, telefono: true, documento: true },
      },
      usuario: { select: { nombre: true } },
      anuladaPor: { select: { nombre: true } },
      deposito: { select: { id: true, nombre: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variante: {
            select: {
              id: true,
              nombre: true,
              sku: true,
              producto: { select: { id: true, nombreCompleto: true } },
            },
          },
        },
      },
      _count: { select: { devoluciones: true } },
    },
  });
  if (!v) throw new NotFoundError("La venta no existe");
  const [movimientos, slug] = await Promise.all([
    db.movimientoStock.count({ where: { referenciaTipo: "VENTA", referenciaId: id } }),
    slugDelPanel(db, ctx),
  ]);
  const costos = opciones.verCostos;
  return {
    id: v.id,
    numero: v.numero,
    idVenta: formatearIdVenta(slug, v.numero),
    fecha: v.fecha,
    estado: v.estado,
    medioPago: v.medioPago,
    cliente: v.cliente
      ? {
          id: v.cliente.id,
          nombre: nombreCliente(v.cliente),
          telefono: v.cliente.telefono,
          documento: v.cliente.documento,
        }
      : null,
    vendedor: v.usuario.nombre,
    deposito: v.deposito,
    subtotal: dec(v.subtotal),
    descuento: dec(v.descuento),
    redondeo: dec(v.redondeo),
    total: dec(v.total),
    costoTotal: costos ? dec(v.costoTotal) : null,
    gananciaBruta: costos ? dec(v.gananciaBruta) : null,
    notas: v.notas,
    anulacion: v.anuladaAt
      ? { por: v.anuladaPor?.nombre ?? "", at: v.anuladaAt, motivo: v.motivoAnulacion }
      : null,
    tieneDevoluciones: v._count.devoluciones > 0,
    items: v.items.map((i) => ({
      id: i.id,
      varianteId: i.varianteId,
      productoId: i.variante.producto.id,
      nombre: nombreConSabor(i.variante.producto.nombreCompleto, i.variante.nombre),
      producto: i.variante.producto.nombreCompleto,
      sabor: saborVisible(i.variante.nombre),
      sku: i.variante.sku,
      cantidad: i.cantidad,
      precioUnitario: dec(i.precioUnitario),
      costoUnitario: costos ? dec(i.costoUnitario) : null,
      subtotal: dec(i.subtotal),
      notas: i.notas,
    })),
    movimientos,
  };
}

export type VentaDetalle = Awaited<ReturnType<typeof obtenerVenta>>;

/** Para retomar un borrador en el POS. */
export async function obtenerBorradorParaPos(ctx: Ctx, id: string) {
  const db = dbPara(ctx.panelId);
  const v = await db.venta.findUnique({
    where: { id },
    select: {
      id: true,
      numero: true,
      estado: true,
      depositoId: true,
      clienteId: true,
      descuento: true,
      notas: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: { varianteId: true, cantidad: true, precioUnitario: true },
      },
    },
  });
  if (!v) throw new NotFoundError("La venta no existe");
  const idVenta = formatearIdVenta(await slugDelPanel(db, ctx), v.numero);
  if (v.estado !== EstadoVenta.BORRADOR)
    throw new DomainError(`La venta ${idVenta} ya no es un borrador.`);
  return { ...v, idVenta };
}

/**
 * `fecha` es timestamp SIN zona (UTC) y la sesión de Postgres está en hora
 * argentina: un Date como parámetro (timestamptz) se compararía corrido 3 h.
 * Se convierte explícitamente a UTC.
 */
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * Grilla rápida del POS: los productos más vendidos del panel en los últimos
 * 30 días (si todavía no hay ventas, los de más stock), con sus variantes y el
 * stock de cada una en el depósito elegido.
 */
export async function productosRapidos(ctx: Ctx, depositoId: string, limite = 12) {
  const db = dbPara(ctx.panelId);
  const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const vendidos = await db.$queryRaw<{ productoId: string }[]>`
    SELECT va."productoId" FROM "VentaItem" vi
    JOIN "Venta" v ON v."id" = vi."ventaId"
    JOIN "Variante" va ON va."id" = vi."varianteId"
    WHERE vi."panelId" = ${ctx.panelId} AND v."panelId" = ${ctx.panelId}
      AND v."estado" = 'CONFIRMADA' AND v."fecha" >= ${utc(desde)}
    GROUP BY va."productoId" ORDER BY SUM(vi."cantidad") DESC LIMIT ${limite}
  `;
  const ids = vendidos.map((v) => v.productoId);
  if (ids.length < limite) {
    const extra = await db.$queryRaw<{ productoId: string }[]>`
      SELECT va."productoId" FROM "Stock" s
      JOIN "Variante" va ON va."id" = s."varianteId"
      JOIN "Producto" p ON p."id" = va."productoId"
      WHERE s."panelId" = ${ctx.panelId} AND s."depositoId" = ${depositoId}
        AND p."deletedAt" IS NULL AND p."activo" AND va."deletedAt" IS NULL AND va."activo"
      GROUP BY va."productoId" ORDER BY SUM(s."cantidad") DESC LIMIT ${limite * 2}
    `;
    for (const e of extra)
      if (ids.length < limite && !ids.includes(e.productoId)) ids.push(e.productoId);
  }
  const productos = await db.producto.findMany({
    where: { id: { in: ids }, deletedAt: null, activo: true },
    select: {
      id: true,
      nombreCompleto: true,
      precioVenta: true,
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
      nombre: p.nombreCompleto,
      precioVenta: dec(p.precioVenta),
      imagenUrl: p.imagenUrl,
      variantes: p.variantes.map((v) => ({
        varianteId: v.id,
        /** El sabor (null si es la variante "Único" de un producto sin sabor). */
        sabor: saborVisible(v.nombre),
        nombreCompleto: nombreConSabor(p.nombreCompleto, v.nombre),
        sku: v.sku,
        precioVenta: precioVentaEfectivo(v, p),
        tienePrecioPropio: tienePrecioPropio(v),
        stock: v.stocks[0]?.cantidad ?? 0,
      })),
    }));
}

export type ProductoRapido = Awaited<ReturnType<typeof productosRapidos>>[number];
