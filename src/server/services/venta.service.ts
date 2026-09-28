import {
  AccionAuditoria,
  EstadoDevolucion,
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
import { registrarMovimiento } from "@/server/services/stock.service";

/**
 * VENTAS (por panel)
 * - Una venta se genera CONFIRMADA de una sola vez (no hay borradores): galpón,
 *   cliente (existente o nuevo), sabores, UN medio de pago. Todo o nada, en una
 *   transacción Serializable con reintentos.
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
  medioPago: MedioPago;
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
  // Varias cajas vendiendo a la vez compiten por la fila de Secuencia y de Stock:
  // cada conflicto de serialización se reintenta (el número no se consume si falla).
  maxRetries: 30,
  timeout: 30_000,
};

const MEDIOS = new Set<string>(Object.values(MedioPago));

/**
 * Genera una venta CONFIRMADA: valida galpón, cliente y medio de pago; crea el
 * cliente nuevo si hace falta (teléfono repetido → ClienteDuplicadoError con el
 * existente); toma precios y costos del servidor; descuenta stock (VENTA por
 * ítem, en orden de varianteId) y registra la auditoría. Si falta stock de
 * cualquier ítem, no se registra NADA.
 */
export async function generarVenta(
  ctx: Ctx,
  input: GenerarVenta,
  permisos: PermisosVenta,
): Promise<VentaGenerada> {
  return medir("confirmarVenta", () =>
    transaccion(ctx, (tx) => generarEnTx(tx, ctx, input, permisos), OPCIONES_GENERAR),
  );
}

async function generarEnTx(
  tx: Tx,
  ctx: Ctx,
  input: GenerarVenta,
  permisos: PermisosVenta,
): Promise<VentaGenerada> {
  // 1. Galpón, medio de pago, cliente e ítems presentes.
  if (!input.depositoId) throw new DomainError("Elegí el galpón de la venta.");
  if (!input.medioPago || !MEDIOS.has(input.medioPago))
    throw new DomainError("Elegí el medio de pago: Efectivo, Transferencia o Binance.");
  if (!input.cliente) throw new DomainError("Elegí el cliente de la venta.");
  if (input.items.length === 0) throw new DomainError("Agregá al menos un producto.");
  const ids = input.items.map((i) => i.varianteId);
  if (new Set(ids).size !== ids.length)
    throw new DomainError("Hay productos repetidos: sumá la cantidad en una sola fila.");

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
        if (!permisos.puedeEditar)
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
    if (!permisos.puedeEditar)
      throw new ForbiddenError("No tenés permiso para aplicar descuentos.");
    descuento = r2(D(input.descuento));
    if (descuento.greaterThan(subtotal)) {
      throw new DomainError("El descuento no puede superar el subtotal.", "VALIDATION_ERROR", 400, {
        descuento: [`Máximo ${dec(subtotal)}`],
      });
    }
  }
  const total = subtotal.minus(descuento);
  const costoTotal = items.reduce((a, i) => a.plus(i.costoUnitario.mul(i.cantidad)), CERO);

  // 3. Stock en el galpón: se informa TODO lo que falta antes de mover nada.
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

  // 5. Número y código del panel (en esta transacción: si algo falla, no se consume).
  const numero = await siguienteNumero(tx, ctx.panelId, "VENTA");
  const codigo = formatearIdVenta(await slugDelPanel(tx, ctx), numero);
  const venta = await tx.venta.create({
    data: {
      numero,
      codigo,
      fecha: ahora(),
      clienteId: cliente.id,
      depositoId: deposito.id,
      vendedorId: ctx.usuarioId,
      tipo: input.tipo,
      estado: EstadoVenta.CONFIRMADA,
      medioPago: input.medioPago,
      subtotal,
      descuento,
      total,
      costoTotal,
      gananciaBruta: total.minus(costoTotal),
      notas: input.notas ?? null,
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
    },
    select: { id: true, fecha: true },
  });

  // 6. Stock: un VENTA por ítem, en orden de varianteId (sin deadlocks entre cajas).
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
      medioPago: input.medioPago,
      tipo: input.tipo,
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
    medioPago: input.medioPago,
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
 * por ítem). No se puede si tiene devoluciones registradas.
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
      await tx.venta.update({
        where: { id },
        data: {
          estado: EstadoVenta.ANULADA,
          anuladaPorId: ctx.usuarioId,
          anuladaAt: ahora(),
          motivoAnulacion: m,
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Venta",
        entidadId: id,
        datosAntes: { estado: EstadoVenta.CONFIRMADA, total: dec(venta.total) },
        datosDespues: { estado: EstadoVenta.ANULADA, codigo: venta.codigo, motivo: m },
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
  if (f.medioPago) where.medioPago = f.medioPago;
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
  medioPago: MedioPago;
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
