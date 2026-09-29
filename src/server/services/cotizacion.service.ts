import "server-only";

import {
  AccionAuditoria,
  EstadoCotizacion,
  Prisma,
  TipoCotizacion,
  TipoVenta,
  type MedioPago,
} from "@prisma/client";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { obtenerEnv } from "@/env";
import { finDelDia, hoyAR, inicioDelDia } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { precioVentaEfectivo } from "@/lib/precios";
import { ahora } from "@/lib/reloj";
import { formatearFecha } from "@/lib/utils";
import {
  MENSAJE_TELEFONO_INVALIDO,
  normalizarTelefono,
  TELEFONO_NORMALIZADO,
} from "@/lib/validations/cliente";
import {
  ETIQUETA_TIPO_COTIZACION,
  formatearIdCotizacion,
  type ClienteCotizacion,
  type FiltrosCotizaciones,
} from "@/lib/validations/cotizacion";
import { nombreConSabor, saborVisible } from "@/lib/ventas-ui";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { siguienteNumero } from "@/server/db/secuencia";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  aWinAnsi,
  COLOR_PDF,
  envolver,
  leerArchivoPublico,
  recortar,
  rectRedondeado,
} from "@/server/pdf";
import { registrarAuditoria } from "@/server/services/audit.service";
import { ClienteDuplicadoError, crearCliente } from "@/server/services/cliente.service";
import { obtenerConfigCotizacion } from "@/server/services/configuracion.service";
import { nombreNegocio } from "@/server/services/identidad.service";
import { calcularPrecios, type ResultadoPrecios } from "@/server/services/precio.service";
import { generarVenta, type VentaGenerada } from "@/server/services/venta.service";
import { claveAleatoria, obtenerStorage } from "@/server/storage";

/**
 * COTIZACIONES (por panel)
 * - Crear/actualizar recalculan SIEMPRE los precios en el servidor
 *   (calcularPrecios): nunca se aceptan precios del cliente salvo `precioManual`
 *   (y el descuento global) con "editar" en COTIZADOR.
 * - Número por Secuencia COTIZACION; código "VAP-Q-000001".
 * - Estados: BORRADOR → ENVIADA → ACEPTADA | RECHAZADA; BORRADOR/ENVIADA pasan
 *   a VENCIDA al pasar `validaHasta`; CONVERTIDA (con su venta) no se modifica
 *   más (lo garantiza un trigger).
 * - convertirEnVenta: todo en una transacción (alta de cliente si hace falta,
 *   venta con los precios cotizados como especiales, cotización CONVERTIDA).
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const CERO = D(0);
const dec = (d: Prisma.Decimal) => d.toFixed(2);
const DIA_MS = 24 * 3600 * 1000;

const EDITABLES: EstadoCotizacion[] = [
  EstadoCotizacion.BORRADOR,
  EstadoCotizacion.ENVIADA,
  EstadoCotizacion.ACEPTADA,
  EstadoCotizacion.VENCIDA,
];
const VENCIBLES: EstadoCotizacion[] = [EstadoCotizacion.BORRADOR, EstadoCotizacion.ENVIADA];
const CONVERTIBLES: EstadoCotizacion[] = [
  EstadoCotizacion.BORRADOR,
  EstadoCotizacion.ENVIADA,
  EstadoCotizacion.ACEPTADA,
  EstadoCotizacion.VENCIDA,
];

export interface PermisosCotizacion {
  /** COTIZADOR "editar": precio manual por ítem y descuento global. */
  puedeEditar: boolean;
}

export interface CotizacionInput {
  tipo: TipoCotizacion;
  items: { varianteId: string; cantidad: number; precioManual?: number | string | null }[];
  cliente: ClienteCotizacion;
  descuento?: number;
  notas?: string;
  validezDias?: number;
}

async function slugDelPanel(db: Tx, ctx: Ctx): Promise<string> {
  const conPanel = ctx as Ctx & { panel?: { slug?: string } };
  if (conPanel.panel?.slug) return conPanel.panel.slug;
  const panel = await db.panel.findUniqueOrThrow({
    where: { id: ctx.panelId },
    select: { slug: true },
  });
  return panel.slug;
}

/** Válida hasta el final del día (hora argentina) de hoy + `dias`. */
function validaHastaDesde(desde: Date, dias: number): Date {
  return finDelDia(hoyAR(new Date(desde.getTime() + dias * DIA_MS)));
}

const estaVencida = (c: { estado: EstadoCotizacion; validaHasta: Date }) =>
  c.estado === EstadoCotizacion.VENCIDA ||
  (VENCIBLES.includes(c.estado) && c.validaHasta.getTime() < ahora().getTime());

/** Pasa a VENCIDA las BORRADOR/ENVIADA cuya validez ya pasó. */
async function marcarVencidas(ctx: Ctx): Promise<void> {
  await dbPara(ctx.panelId).cotizacion.updateMany({
    where: { estado: { in: VENCIBLES }, validaHasta: { lt: ahora() }, deletedAt: null },
    data: { estado: EstadoCotizacion.VENCIDA },
  });
}

async function resolverCliente(
  tx: Tx,
  cliente: ClienteCotizacion,
): Promise<{
  clienteId: string | null;
  clienteNombre: string | null;
  clienteTelefono: string | null;
}> {
  if (!cliente) return { clienteId: null, clienteNombre: null, clienteTelefono: null };
  if ("id" in cliente) {
    const c = await tx.cliente.findFirst({
      where: { id: cliente.id, deletedAt: null },
      select: { id: true, nombre: true, telefono: true },
    });
    if (!c) throw new NotFoundError("El cliente no existe o fue dado de baja.");
    return { clienteId: c.id, clienteNombre: c.nombre, clienteTelefono: c.telefono };
  }
  const nombre = cliente.nombre.trim().replace(/\s+/g, " ");
  if (!nombre) throw new ValidationError("Ingresá el nombre", { nombre: ["Ingresá el nombre"] });
  const telefono = normalizarTelefono(cliente.telefono);
  if (!telefono || !TELEFONO_NORMALIZADO.test(telefono))
    throw new ValidationError(MENSAJE_TELEFONO_INVALIDO, { telefono: [MENSAJE_TELEFONO_INVALIDO] });
  // Si el teléfono ya es de un cliente del panel, la cotización queda a su nombre.
  const existente = await tx.cliente.findFirst({
    where: { telefono, deletedAt: null },
    select: { id: true, nombre: true, telefono: true },
  });
  if (existente)
    return {
      clienteId: existente.id,
      clienteNombre: existente.nombre,
      clienteTelefono: existente.telefono,
    };
  return { clienteId: null, clienteNombre: nombre, clienteTelefono: telefono };
}

function exigirDescuento(
  descuento: number | undefined,
  subtotal: Prisma.Decimal,
  permisos: PermisosCotizacion,
): Prisma.Decimal {
  if (descuento === undefined || descuento <= 0) return CERO;
  if (!permisos.puedeEditar) throw new ForbiddenError("No tenés permiso para aplicar descuentos.");
  const d = D(descuento).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (d.greaterThan(subtotal))
    throw new DomainError("El descuento no puede superar el subtotal.", "VALIDATION_ERROR", 400, {
      descuento: [`Máximo ${dec(subtotal)}`],
    });
  return d;
}

const itemsParaCrear = (precios: ResultadoPrecios) =>
  precios.items.map((i) => ({
    varianteId: i.varianteId,
    productoId: i.productoId,
    cantidad: i.cantidad,
    precioLista: i.precioLista,
    precioUnitario: i.precioUnitario,
    escalonAplicado: i.escalonAplicado,
    esPrecioManual: i.esPrecioManual,
    subtotal: i.subtotal,
  }));

// =============================================================================
// Crear / actualizar / duplicar
// =============================================================================

export async function crearCotizacion(
  ctx: Ctx,
  input: CotizacionInput,
  permisos: PermisosCotizacion,
): Promise<{ id: string; codigo: string }> {
  if (input.items.length === 0) throw new DomainError("Agregá al menos un producto.");
  return transaccion(
    ctx,
    async (tx) => {
      const precios = await calcularPrecios(
        ctx,
        { tipo: input.tipo, items: input.items },
        permisos,
        tx,
      );
      const subtotal = D(precios.subtotal);
      const descuento = exigirDescuento(input.descuento, subtotal, permisos);
      const config = await obtenerConfigCotizacion(ctx, tx);
      const cliente = await resolverCliente(tx, input.cliente);
      const numero = await siguienteNumero(tx, ctx.panelId, "COTIZACION");
      const codigo = formatearIdCotizacion(await slugDelPanel(tx, ctx), numero);
      const fecha = ahora();
      const c = await tx.cotizacion.create({
        data: {
          numero,
          codigo,
          tipo: input.tipo,
          fecha,
          validaHasta: validaHastaDesde(fecha, input.validezDias ?? config.validezDias),
          ...cliente,
          vendedorId: ctx.usuarioId,
          estado: EstadoCotizacion.BORRADOR,
          subtotal,
          descuento,
          total: subtotal.minus(descuento),
          notas: input.notas?.trim() || null,
          items: { create: itemsParaCrear(precios) },
        },
        select: { id: true },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.CREATE,
        entidad: "Cotizacion",
        entidadId: c.id,
        datosDespues: {
          codigo,
          tipo: input.tipo,
          clienteId: cliente.clienteId,
          subtotal: precios.subtotal,
          descuento: dec(descuento),
          total: dec(subtotal.minus(descuento)),
          items: precios.items.map((i) => ({
            varianteId: i.varianteId,
            cantidad: i.cantidad,
            precioUnitario: i.precioUnitario,
            esPrecioManual: i.esPrecioManual,
          })),
        },
        meta: ctx.meta,
      });
      return { id: c.id, codigo };
    },
    { maxRetries: 20, timeout: 30_000 },
  );
}

async function bloquear(tx: Tx, ctx: Ctx, id: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "Cotizacion" WHERE "id" = ${id} AND "panelId" = ${ctx.panelId} FOR UPDATE
  `;
  const c = await tx.cotizacion.findFirst({
    where: { id, deletedAt: null },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!c) throw new NotFoundError("La cotización no existe.");
  return c;
}

export async function actualizarCotizacion(
  ctx: Ctx,
  id: string,
  input: CotizacionInput,
  permisos: PermisosCotizacion,
): Promise<{ id: string; codigo: string }> {
  if (input.items.length === 0) throw new DomainError("Agregá al menos un producto.");
  return transaccion(
    ctx,
    async (tx) => {
      const actual = await bloquear(tx, ctx, id);
      if (!EDITABLES.includes(actual.estado))
        throw new DomainError(
          `La cotización ${actual.codigo} está ${actual.estado.toLowerCase()}: duplicala para armar una nueva.`,
        );
      const precios = await calcularPrecios(
        ctx,
        { tipo: input.tipo, items: input.items },
        permisos,
        tx,
      );
      const subtotal = D(precios.subtotal);
      const descuento = exigirDescuento(input.descuento, subtotal, permisos);
      const cliente = await resolverCliente(tx, input.cliente);
      const vencida = estaVencida(actual);
      let validaHasta = actual.validaHasta;
      if (input.validezDias !== undefined)
        validaHasta = validaHastaDesde(ahora(), input.validezDias);
      else if (vencida)
        validaHasta = validaHastaDesde(
          ahora(),
          (await obtenerConfigCotizacion(ctx, tx)).validezDias,
        );
      await tx.cotizacionItem.deleteMany({ where: { cotizacionId: id } });
      await tx.cotizacion.update({
        where: { id },
        data: {
          tipo: input.tipo,
          validaHasta,
          ...cliente,
          // Editada después de vencer: vuelve a borrador con validez nueva.
          estado: vencida ? EstadoCotizacion.BORRADOR : actual.estado,
          subtotal,
          descuento,
          total: subtotal.minus(descuento),
          notas: input.notas?.trim() || null,
          pdfUrl: null,
          items: { create: itemsParaCrear(precios) },
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Cotizacion",
        entidadId: id,
        datosAntes: {
          estado: actual.estado,
          total: dec(actual.total),
          items: actual.items.map((i) => ({
            varianteId: i.varianteId,
            cantidad: i.cantidad,
            precioUnitario: dec(i.precioUnitario),
          })),
        },
        datosDespues: {
          tipo: input.tipo,
          total: dec(subtotal.minus(descuento)),
          items: precios.items.map((i) => ({
            varianteId: i.varianteId,
            cantidad: i.cantidad,
            precioUnitario: i.precioUnitario,
            esPrecioManual: i.esPrecioManual,
          })),
        },
        meta: ctx.meta,
      });
      return { id, codigo: actual.codigo };
    },
    { maxRetries: 10, timeout: 30_000 },
  );
}

/**
 * Nueva cotización (BORRADOR, del usuario actual) con los mismos productos,
 * cantidades, cliente y notas, a los PRECIOS DE HOY (sin precios manuales ni
 * descuento). Los sabores dados de baja o inactivos se omiten.
 */
export async function duplicar(ctx: Ctx, id: string): Promise<{ id: string; codigo: string }> {
  const db = dbPara(ctx.panelId);
  const c = await db.cotizacion.findFirst({
    where: { id, deletedAt: null },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: { variante: { select: { activo: true, deletedAt: true, producto: true } } },
      },
    },
  });
  if (!c) throw new NotFoundError("La cotización no existe.");
  const items = c.items
    .filter(
      (i) =>
        i.variante.activo &&
        !i.variante.deletedAt &&
        i.variante.producto.activo &&
        !i.variante.producto.deletedAt,
    )
    .map((i) => ({ varianteId: i.varianteId, cantidad: i.cantidad }));
  if (items.length === 0)
    throw new DomainError("Ninguno de los productos de la cotización está disponible hoy.");
  const cliente: ClienteCotizacion = c.clienteId
    ? { id: c.clienteId }
    : c.clienteNombre && c.clienteTelefono
      ? { nombre: c.clienteNombre, telefono: c.clienteTelefono }
      : null;
  return crearCotizacion(
    ctx,
    { tipo: c.tipo, items, cliente, notas: c.notas ?? undefined },
    { puedeEditar: false },
  );
}

// =============================================================================
// Estados
// =============================================================================

async function cambiarEstado(
  ctx: Ctx,
  id: string,
  destino: EstadoCotizacion,
  desde: EstadoCotizacion[],
  extra: Prisma.CotizacionUpdateInput = {},
): Promise<{ id: string; codigo: string; estado: EstadoCotizacion }> {
  return transaccion(ctx, async (tx) => {
    const c = await bloquear(tx, ctx, id);
    const vencida = estaVencida(c);
    if (vencida && destino !== EstadoCotizacion.RECHAZADA)
      throw new DomainError(
        `La cotización ${c.codigo} está vencida: actualizala o duplicala a precios de hoy.`,
      );
    if (!desde.includes(c.estado))
      throw new DomainError(
        `La cotización ${c.codigo} está ${c.estado.toLowerCase()}: no puede pasar a ${destino.toLowerCase()}.`,
      );
    await tx.cotizacion.update({ where: { id }, data: { estado: destino, ...extra } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Cotizacion",
      entidadId: id,
      datosAntes: { estado: c.estado },
      datosDespues: { estado: destino, codigo: c.codigo, ...(extra as Record<string, string>) },
      meta: ctx.meta,
    });
    return { id, codigo: c.codigo, estado: destino };
  });
}

export function marcarEnviada(ctx: Ctx, id: string) {
  return cambiarEstado(ctx, id, EstadoCotizacion.ENVIADA, [
    EstadoCotizacion.BORRADOR,
    EstadoCotizacion.ENVIADA,
  ]);
}

export function marcarAceptada(ctx: Ctx, id: string) {
  return cambiarEstado(ctx, id, EstadoCotizacion.ACEPTADA, [
    EstadoCotizacion.BORRADOR,
    EstadoCotizacion.ENVIADA,
  ]);
}

export function marcarRechazada(ctx: Ctx, id: string, motivo?: string) {
  return cambiarEstado(
    ctx,
    id,
    EstadoCotizacion.RECHAZADA,
    [
      EstadoCotizacion.BORRADOR,
      EstadoCotizacion.ENVIADA,
      EstadoCotizacion.ACEPTADA,
      EstadoCotizacion.VENCIDA,
    ],
    { motivoRechazo: motivo?.trim() || null },
  );
}

// =============================================================================
// Lectura
// =============================================================================

export async function obtener(ctx: Ctx, id: string) {
  await marcarVencidas(ctx);
  const db = dbPara(ctx.panelId);
  const c = await db.cotizacion.findFirst({
    where: { id, deletedAt: null },
    include: {
      cliente: { select: { id: true, nombre: true, telefono: true } },
      vendedor: { select: { id: true, nombre: true } },
      venta: { select: { id: true, codigo: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variante: { select: { nombre: true, sku: true } },
          producto: { select: { nombreCompleto: true } },
        },
      },
    },
  });
  if (!c) throw new NotFoundError("La cotización no existe.");
  const config = await obtenerConfigCotizacion(ctx);
  const totalUnidades = c.items.reduce((a, i) => a + i.cantidad, 0);
  const resumenEscalones: {
    productoId: string;
    nombreCompleto: string;
    unidades: number;
    escalonAplicado: number | null;
    precioUnitario: string;
  }[] = [];
  if (c.tipo === TipoCotizacion.MAYORISTA) {
    for (const i of c.items) {
      const r = resumenEscalones.find((x) => x.productoId === i.productoId);
      if (r) {
        if (config.modoEscalonMayorista === "POR_PRODUCTO") r.unidades += i.cantidad;
        continue;
      }
      const ref = c.items.find((x) => x.productoId === i.productoId && !x.esPrecioManual) ?? i;
      resumenEscalones.push({
        productoId: i.productoId,
        nombreCompleto: i.producto.nombreCompleto,
        unidades: config.modoEscalonMayorista === "POR_TOTAL" ? totalUnidades : i.cantidad,
        escalonAplicado: ref.escalonAplicado,
        precioUnitario: dec(ref.precioUnitario),
      });
    }
  }
  return {
    id: c.id,
    numero: c.numero,
    codigo: c.codigo,
    tipo: c.tipo,
    estado: c.estado,
    fecha: c.fecha,
    validaHasta: c.validaHasta,
    vencida: estaVencida(c),
    cliente: c.cliente
      ? { id: c.cliente.id, nombre: c.cliente.nombre, telefono: c.cliente.telefono }
      : c.clienteNombre
        ? { id: null, nombre: c.clienteNombre, telefono: c.clienteTelefono }
        : null,
    vendedor: c.vendedor,
    subtotal: dec(c.subtotal),
    descuento: dec(c.descuento),
    total: dec(c.total),
    notas: c.notas,
    motivoRechazo: c.motivoRechazo,
    venta: c.venta,
    pdfUrl: c.pdfUrl,
    modo: config.modoEscalonMayorista,
    unidades: totalUnidades,
    resumenEscalones,
    items: c.items.map((i) => ({
      id: i.id,
      varianteId: i.varianteId,
      productoId: i.productoId,
      titulo: nombreConSabor(i.producto.nombreCompleto, i.variante.nombre),
      producto: i.producto.nombreCompleto,
      sabor: saborVisible(i.variante.nombre),
      sku: i.variante.sku,
      cantidad: i.cantidad,
      precioLista: dec(i.precioLista),
      precioUnitario: dec(i.precioUnitario),
      escalonAplicado: i.escalonAplicado,
      esPrecioManual: i.esPrecioManual,
      subtotal: dec(i.subtotal),
    })),
  };
}

export type CotizacionDetalle = Awaited<ReturnType<typeof obtener>>;

function whereCotizaciones(f: Partial<FiltrosCotizaciones>): Prisma.CotizacionWhereInput {
  const where: Prisma.CotizacionWhereInput = { deletedAt: null };
  if (f.tipo) where.tipo = f.tipo;
  if (f.estado) where.estado = f.estado;
  if (f.vendedorId) where.vendedorId = f.vendedorId;
  if (f.clienteId) where.clienteId = f.clienteId;
  if (f.desde || f.hasta) {
    where.fecha = {
      ...(f.desde ? { gte: inicioDelDia(f.desde) } : {}),
      ...(f.hasta ? { lte: finDelDia(f.hasta) } : {}),
    };
  }
  const q = f.q?.trim().replace(/^#/, "");
  if (q) {
    const numero = q.match(/^(?:[a-z]{1,3}-q-)?0*(\d{1,9})$/i);
    const digitos = q.replace(/\D/g, "");
    const or: Prisma.CotizacionWhereInput[] = [
      { codigo: { contains: q, mode: "insensitive" } },
      { clienteNombre: { contains: q, mode: "insensitive" } },
      { cliente: { nombre: { contains: q, mode: "insensitive" } } },
    ];
    if (numero) or.push({ numero: Number(numero[1]) });
    if (digitos.length >= 4) {
      or.push({ clienteTelefono: { contains: digitos } });
      or.push({ cliente: { telefono: { contains: digitos } } });
    }
    where.OR = or;
  }
  return where;
}

export interface CotizacionListada {
  id: string;
  codigo: string;
  fecha: Date;
  validaHasta: Date;
  tipo: TipoCotizacion;
  estado: EstadoCotizacion;
  cliente: { id: string | null; nombre: string; telefono: string | null } | null;
  /** Nombre del cliente (o del destinatario sin cliente), null si no tiene. */
  clienteNombre: string | null;
  clienteTelefono: string | null;
  vendedorId: string;
  /** Nombre del vendedor. */
  vendedor: string;
  items: number;
  unidades: number;
  total: string;
  venta: { id: string; codigo: string } | null;
}

export async function listar(
  ctx: Ctx,
  f: Partial<FiltrosCotizaciones>,
): Promise<{ cotizaciones: CotizacionListada[]; total: number; page: number; pageSize: number }> {
  await marcarVencidas(ctx);
  const db = dbPara(ctx.panelId);
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 30;
  const where = whereCotizaciones(f);
  const [total, filas] = await Promise.all([
    db.cotizacion.count({ where }),
    db.cotizacion.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        cliente: { select: { id: true, nombre: true, telefono: true } },
        vendedor: { select: { id: true, nombre: true } },
        venta: { select: { id: true, codigo: true } },
        items: { select: { cantidad: true } },
      },
    }),
  ]);
  return {
    cotizaciones: filas.map((c) => ({
      id: c.id,
      codigo: c.codigo,
      fecha: c.fecha,
      validaHasta: c.validaHasta,
      tipo: c.tipo,
      estado: c.estado,
      cliente: c.cliente
        ? { id: c.cliente.id, nombre: c.cliente.nombre, telefono: c.cliente.telefono }
        : c.clienteNombre
          ? { id: null, nombre: c.clienteNombre, telefono: c.clienteTelefono }
          : null,
      clienteNombre: c.cliente?.nombre ?? c.clienteNombre,
      clienteTelefono: c.cliente?.telefono ?? c.clienteTelefono,
      vendedorId: c.vendedor.id,
      vendedor: c.vendedor.nombre,
      items: c.items.length,
      unidades: c.items.reduce((a, i) => a + i.cantidad, 0),
      total: dec(c.total),
      venta: c.venta,
    })),
    total,
    page,
    pageSize,
  };
}

export interface ResumenCotizaciones {
  cantidad: number;
  montoTotal: string;
  porEstado: Record<EstadoCotizacion, { cantidad: number; monto: string }>;
  /** Convertidas / (todas menos borradores), 0 a 1. */
  tasaConversion: number;
  montoConvertido: string;
}

export async function resumenCotizaciones(
  ctx: Ctx,
  f: { desde?: string; hasta?: string; vendedorId?: string },
): Promise<ResumenCotizaciones> {
  await marcarVencidas(ctx);
  const grupos = await dbPara(ctx.panelId).cotizacion.groupBy({
    by: ["estado"],
    where: whereCotizaciones(f),
    _count: true,
    _sum: { total: true },
  });
  const porEstado = Object.fromEntries(
    Object.values(EstadoCotizacion).map((e) => [e, { cantidad: 0, monto: "0.00" }]),
  ) as ResumenCotizaciones["porEstado"];
  let cantidad = 0;
  let monto = CERO;
  for (const g of grupos) {
    porEstado[g.estado] = { cantidad: g._count, monto: dec(g._sum.total ?? CERO) };
    cantidad += g._count;
    monto = monto.plus(g._sum.total ?? CERO);
  }
  const base = cantidad - porEstado.BORRADOR.cantidad;
  return {
    cantidad,
    montoTotal: dec(monto),
    porEstado,
    tasaConversion: base > 0 ? porEstado.CONVERTIDA.cantidad / base : 0,
    montoConvertido: porEstado.CONVERTIDA.monto,
  };
}

// =============================================================================
// WhatsApp y PDF
// =============================================================================

function urlAbsoluta(ref: string | null): string | null {
  if (!ref) return null;
  if (/^https?:\/\//.test(ref)) return ref;
  const base = obtenerEnv().NEXT_PUBLIC_APP_URL;
  return base ? `${base.replace(/\/$/, "")}${ref}` : null;
}

export async function textoWhatsApp(
  ctx: Ctx,
  id: string,
): Promise<{ texto: string; telefono: string | null }> {
  const c = await obtener(ctx, id);
  const config = await obtenerConfigCotizacion(ctx);
  const mayorista = c.tipo === TipoCotizacion.MAYORISTA;
  const lineas = [
    c.cliente ? `¡Hola ${c.cliente.nombre}!` : "¡Hola!",
    `Te paso la cotización ${c.codigo} (${ETIQUETA_TIPO_COTIZACION[c.tipo].toLowerCase()}):`,
    "",
    ...c.items.map(
      (i) =>
        `• ${i.cantidad} × ${i.titulo}: ${formatearPesos(i.precioUnitario)} c/u = ${formatearPesos(i.subtotal)}`,
    ),
    "",
    ...(mayorista
      ? c.resumenEscalones.map(
          (r) =>
            `${r.nombreCompleto}: ${r.unidades} u. → ${
              r.escalonAplicado ? `precio desde ${r.escalonAplicado} u.` : "precio de lista"
            }`,
        )
      : []),
    ...(Number(c.descuento) > 0
      ? [`Subtotal: ${formatearPesos(c.subtotal)}`, `Descuento: −${formatearPesos(c.descuento)}`]
      : []),
    `Total: ${formatearPesos(c.total)}`,
    `Válida hasta el ${formatearFecha(c.validaHasta)}.`,
    ...(config.leyenda ? [config.leyenda] : []),
    ...(urlAbsoluta(c.pdfUrl) ? [`PDF: ${urlAbsoluta(c.pdfUrl)}`] : []),
  ];
  return { texto: lineas.join("\n"), telefono: c.cliente?.telefono ?? null };
}

const PREFIJO_ARCHIVOS = "/api/publico/archivos/";

async function cargarLogo(doc: PDFDocument, logoUrl: string | null): Promise<PDFImage | null> {
  if (!logoUrl) return null;
  try {
    let datos: Uint8Array | null = null;
    if (logoUrl.startsWith(PREFIJO_ARCHIVOS)) {
      datos = (await obtenerStorage().leer(logoUrl.slice(PREFIJO_ARCHIVOS.length)))?.datos ?? null;
    } else if (/^https?:\/\//.test(logoUrl)) {
      const r = await fetch(logoUrl, { signal: AbortSignal.timeout(3000) });
      if (r.ok) datos = new Uint8Array(await r.arrayBuffer());
    } else if (logoUrl.startsWith("/")) {
      datos = await leerArchivoPublico(logoUrl);
    }
    if (!datos || datos.length < 4) return null;
    if (datos[0] === 0x89 && datos[1] === 0x50) return await doc.embedPng(datos);
    if (datos[0] === 0xff && datos[1] === 0xd8) return await doc.embedJpg(datos);
    return null;
  } catch {
    return null;
  }
}

/**
 * PDF de la cotización (A4): logo y nombre del negocio, código, fecha,
 * validez, cliente, tabla de productos (en mayorista con columna "Escalón" y
 * resumen de escalones al pie), descuento, total, leyenda y vendedor. Se
 * guarda en el storage y queda en `pdfUrl` (salvo en una convertida, que ya
 * no se modifica: ahí solo se devuelve el link).
 */
export async function generarPDF(ctx: Ctx, id: string): Promise<{ url: string }> {
  const c = await obtener(ctx, id);
  const db = dbPara(ctx.panelId);
  const [panel, config, negocio] = await Promise.all([
    db.panel.findUniqueOrThrow({
      where: { id: ctx.panelId },
      select: { nombre: true, logoUrl: true },
    }),
    obtenerConfigCotizacion(ctx),
    nombreNegocio(),
  ]);
  const mayorista = c.tipo === TipoCotizacion.MAYORISTA;

  const doc = await PDFDocument.create();
  doc.setTitle(`Cotización ${c.codigo}`);
  doc.setCreator(negocio);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await cargarLogo(doc, panel.logoUrl);

  const mono = await doc.embedFont(StandardFonts.CourierBold);

  const ANCHO = 595.28;
  const ALTO = 841.89;
  const M = 40;
  const util = ANCHO - 2 * M;
  const negro = COLOR_PDF.texto;
  const gris = COLOR_PDF.muted;
  const grisClaro = COLOR_PDF.subtle;
  const fondo = COLOR_PDF.card;
  const linea = COLOR_PDF.borde;
  const PIE = 44;
  let page: PDFPage = doc.addPage([ANCHO, ALTO]);
  let y = ALTO - M;

  const texto = (
    t: string,
    x: number,
    yy: number,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; derecha?: boolean } = {},
  ) => {
    const font = opts.font ?? normal;
    const size = opts.size ?? 9;
    const s = aWinAnsi(t, font);
    const dx = opts.derecha ? font.widthOfTextAtSize(s, size) : 0;
    page.drawText(s, { x: x - dx, y: yy, size, font, color: opts.color ?? negro });
  };
  const raya = (yy: number, grosor = 0.4, color = linea) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: ANCHO - M, y: yy },
      thickness: grosor,
      color,
    });

  // Cabecera: logo del panel a la izquierda, datos del negocio a la derecha.
  const ALTO_CAB = 48;
  if (logo) {
    const escala = Math.min(170 / logo.width, ALTO_CAB / logo.height);
    page.drawImage(logo, {
      x: M,
      y: y - ALTO_CAB + (ALTO_CAB - logo.height * escala) / 2,
      width: logo.width * escala,
      height: logo.height * escala,
    });
  } else {
    texto(panel.nombre, M, y - 30, { size: 20, font: negrita });
  }
  texto(negocio, ANCHO - M, y - 14, { size: 11, font: negrita, derecha: true });
  texto(panel.nombre, ANCHO - M, y - 28, { size: 9, color: gris, derecha: true });
  texto(`Vendedor: ${c.vendedor.nombre}`, ANCHO - M, y - 41, {
    size: 8.5,
    color: gris,
    derecha: true,
  });
  y -= ALTO_CAB + 16;
  raya(y, 0.6);
  y -= 34;

  // Título + código
  texto(`Cotización ${ETIQUETA_TIPO_COTIZACION[c.tipo].toLowerCase()}`, M, y, {
    size: 20,
    font: negrita,
  });
  texto(c.codigo, ANCHO - M, y, { size: 14, font: mono, derecha: true });
  y -= 22;

  // Datos: fecha, validez y cliente en una banda gris.
  const altoDatos = 44;
  rectRedondeado(page, M, y - altoDatos, util, altoDatos, 6, fondo);
  const celda = (x: number, etiqueta: string, valor: string, fuerte = false) => {
    texto(etiqueta, x, y - 16, { size: 7.5, color: gris });
    texto(valor, x, y - 31, { size: 10, font: fuerte ? negrita : normal });
  };
  const colDatos = util / 4;
  celda(M + 12, "Fecha", formatearFecha(c.fecha));
  celda(M + 12 + colDatos, "Válida hasta", formatearFecha(c.validaHasta), true);
  const cliente = c.cliente
    ? `${c.cliente.nombre}${c.cliente.telefono ? ` · ${c.cliente.telefono}` : ""}`
    : "—";
  texto("Cliente", M + 12 + 2 * colDatos, y - 16, { size: 7.5, color: gris });
  texto(
    recortar(aWinAnsi(cliente, normal), normal, 10, 2 * colDatos - 24),
    M + 12 + 2 * colDatos,
    y - 31,
    { size: 10 },
  );
  y -= altoDatos + 26;

  // Tabla
  const cols = mayorista
    ? { cant: 50, esc: 64, precio: 84, sub: 92 }
    : { cant: 56, esc: 0, precio: 96, sub: 104 };
  const anchoProducto = util - cols.cant - cols.esc - cols.precio - cols.sub;
  const xCant = M + anchoProducto + cols.cant;
  const xEsc = xCant + cols.esc;
  const xPrecio = xEsc + cols.precio;
  const xSub = xPrecio + cols.sub;
  const encabezado = () => {
    rectRedondeado(page, M, y - 7, util, 22, 4, fondo);
    const o = { font: negrita, size: 8, color: gris };
    texto("Producto", M + 10, y, o);
    texto("Cant.", xCant - 8, y, { ...o, derecha: true });
    if (mayorista) texto("Escalón", xEsc - 8, y, { ...o, derecha: true });
    texto("Precio c/u", xPrecio - 8, y, { ...o, derecha: true });
    texto("Subtotal", xSub - 10, y, { ...o, derecha: true });
    y -= 26;
  };
  const nuevaPagina = () => {
    page = doc.addPage([ANCHO, ALTO]);
    y = ALTO - M;
    texto(`${c.codigo} (continuación)`, M, y, { color: gris, font: negrita });
    y -= 10;
    raya(y, 0.6);
    y -= 22;
  };
  encabezado();
  for (const i of c.items) {
    if (y < M + PIE + 10) {
      nuevaPagina();
      encabezado();
    }
    texto(recortar(aWinAnsi(i.titulo, normal), normal, 9.5, anchoProducto - 16), M + 10, y, {
      size: 9.5,
    });
    texto(String(i.cantidad), xCant - 8, y, { derecha: true, size: 9.5 });
    if (mayorista)
      texto(
        i.esPrecioManual ? "Especial" : i.escalonAplicado ? `${i.escalonAplicado}+` : "Lista",
        xEsc - 8,
        y,
        { derecha: true, color: gris, size: 9 },
      );
    texto(formatearPesos(i.precioUnitario), xPrecio - 8, y, { derecha: true, size: 9.5 });
    texto(formatearPesos(i.subtotal), xSub - 10, y, { derecha: true, size: 9.5, font: negrita });
    y -= 8;
    raya(y, 0.4);
    y -= 15;
  }

  // Totales (alineados a la derecha, total en negrita con línea negra)
  const bloqueTotales = (Number(c.descuento) > 0 ? 3 : 1) * 18 + 20;
  if (y < M + PIE + bloqueTotales) nuevaPagina();
  y -= 4;
  const xEtiqueta = xPrecio - 8;
  if (Number(c.descuento) > 0) {
    texto("Subtotal", xEtiqueta, y, { derecha: true, color: gris });
    texto(formatearPesos(c.subtotal), xSub - 10, y, { derecha: true });
    y -= 16;
    texto("Descuento", xEtiqueta, y, { derecha: true, color: gris });
    texto(`−${formatearPesos(c.descuento)}`, xSub - 10, y, { derecha: true });
    y -= 12;
  }
  page.drawLine({
    start: { x: xEsc - (mayorista ? 0 : 20), y: y + 1 },
    end: { x: ANCHO - M, y: y + 1 },
    thickness: 0.8,
    color: negro,
  });
  y -= 18;
  texto("Total", xEtiqueta, y, { font: negrita, size: 12, derecha: true });
  texto(formatearPesos(c.total), xSub - 10, y, { font: negrita, size: 14, derecha: true });
  y -= 34;

  const parrafo = (titulo: string | null, lineas: string[], color = negro) => {
    if (y < M + PIE + 20) nuevaPagina();
    if (titulo) {
      texto(titulo, M, y, { font: negrita, size: 10 });
      y -= 15;
    }
    for (const l of lineas) {
      for (const lin of envolver(aWinAnsi(l, normal), normal, 9, util)) {
        if (y < M + PIE) nuevaPagina();
        texto(lin, M, y, { color });
        y -= 13;
      }
    }
    y -= 10;
  };

  if (mayorista && c.resumenEscalones.length) {
    parrafo(
      c.modo === "POR_TOTAL"
        ? `Resumen de escalones (por total de unidades: ${c.unidades} u.)`
        : "Resumen de escalones",
      c.resumenEscalones.map(
        (r) =>
          `${r.nombreCompleto}: ${r.unidades} u. — ${
            r.escalonAplicado
              ? `escalón desde ${r.escalonAplicado} u. a ${formatearPesos(r.precioUnitario)} c/u`
              : "precio de lista"
          }`,
      ),
      gris,
    );
  }
  if (c.notas) parrafo("Notas", [c.notas], gris);
  // Leyenda corta: al pie de cada página; larga: como párrafo al final.
  const lineasLeyenda = config.leyenda
    ? envolver(aWinAnsi(config.leyenda, normal), normal, 7.5, util - 120)
    : [];
  if (lineasLeyenda.length > 2) parrafo(null, [config.leyenda], gris);

  // Pie de cada página: leyenda + código y página.
  const paginas = doc.getPages();
  const leyenda = lineasLeyenda.length <= 2 ? lineasLeyenda : [];
  paginas.forEach((p, n) => {
    p.drawLine({
      start: { x: M, y: M + 4 },
      end: { x: ANCHO - M, y: M + 4 },
      thickness: 0.4,
      color: linea,
    });
    leyenda.forEach((l, k) =>
      p.drawText(l, { x: M, y: M - 8 - k * 10, size: 7.5, font: normal, color: gris }),
    );
    const t = aWinAnsi(`${c.codigo} · Página ${n + 1} de ${paginas.length}`, normal);
    p.drawText(t, {
      x: ANCHO - M - normal.widthOfTextAtSize(t, 7.5),
      y: M - 8,
      size: 7.5,
      font: normal,
      color: grisClaro,
    });
  });

  const bytes = await doc.save();
  const url = await obtenerStorage().guardar(
    claveAleatoria("cotizaciones", c.codigo, "pdf"),
    bytes,
    "application/pdf",
  );
  if (c.estado !== EstadoCotizacion.CONVERTIDA) {
    await db.cotizacion.update({ where: { id }, data: { pdfUrl: url } });
  }
  return { url };
}

// =============================================================================
// Conversión en venta
// =============================================================================

export interface PreparacionConversion {
  cotizacion: {
    id: string;
    codigo: string;
    tipo: TipoCotizacion;
    estado: EstadoCotizacion;
    subtotal: string;
    descuento: string;
    total: string;
    items: {
      varianteId: string;
      titulo: string;
      cantidad: number;
      precioUnitario: string;
      stockTotal: number;
    }[];
  };
  cliente:
    { id: string; nombre: string; telefono: string } | { nombre: string; telefono: string } | null;
  vencida: boolean;
  /** Solo si está vencida: los precios que cambiarían al recalcular a hoy. */
  cambios: { titulo: string; antes: string; despues: string }[];
}

export async function prepararConversion(ctx: Ctx, id: string): Promise<PreparacionConversion> {
  const c = await obtener(ctx, id);
  if (!CONVERTIBLES.includes(c.estado))
    throw new DomainError(
      `La cotización ${c.codigo} está ${c.estado.toLowerCase()}: no se puede convertir.`,
    );
  const stocks = await dbPara(ctx.panelId).stock.groupBy({
    by: ["varianteId"],
    where: { varianteId: { in: c.items.map((i) => i.varianteId) }, deposito: { activo: true } },
    _sum: { cantidad: true },
  });
  const stockDe = new Map(stocks.map((s) => [s.varianteId, s._sum.cantidad ?? 0]));
  const cambios: PreparacionConversion["cambios"] = [];
  if (c.vencida) {
    const hoy = await calcularPrecios(
      ctx,
      {
        tipo: c.tipo,
        items: c.items.map((i) => ({ varianteId: i.varianteId, cantidad: i.cantidad })),
      },
      { puedeEditar: false },
    );
    for (const i of c.items) {
      const nuevo = hoy.items.find((x) => x.varianteId === i.varianteId);
      if (nuevo && nuevo.precioUnitario !== i.precioUnitario)
        cambios.push({ titulo: i.titulo, antes: i.precioUnitario, despues: nuevo.precioUnitario });
    }
  }
  return {
    cotizacion: {
      id: c.id,
      codigo: c.codigo,
      tipo: c.tipo,
      estado: c.estado,
      subtotal: c.subtotal,
      descuento: c.descuento,
      total: c.total,
      items: c.items.map((i) => ({
        varianteId: i.varianteId,
        titulo: i.titulo,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        stockTotal: stockDe.get(i.varianteId) ?? 0,
      })),
    },
    cliente: c.cliente
      ? c.cliente.id
        ? { id: c.cliente.id, nombre: c.cliente.nombre, telefono: c.cliente.telefono ?? "" }
        : c.cliente.telefono
          ? { nombre: c.cliente.nombre, telefono: c.cliente.telefono }
          : null
      : null,
    vencida: c.vencida,
    cambios,
  };
}

/**
 * Convierte la cotización en una venta CONFIRMADA, en UNA transacción:
 * cliente (el elegido, el de la cotización o uno nuevo con su nombre y
 * teléfono; si el teléfono ya existe se usa ese cliente), venta con los
 * precios cotizados (precio especial cuando difiere de la lista de hoy, sin
 * exigir "editar": ya los fijó la cotización), tipo de la cotización y
 * vínculo `cotizacionId`; la cotización queda CONVERTIDA con su venta. Si
 * falta stock falla entera y la cotización queda como estaba. Vencida con
 * `recalcular`: precios de hoy.
 */
export async function convertirEnVenta(
  ctx: Ctx,
  id: string,
  opciones: { depositoId: string; medioPago: MedioPago; clienteId?: string; recalcular?: boolean },
): Promise<VentaGenerada> {
  return transaccion(
    ctx,
    async (tx) => {
      const c = await bloquear(tx, ctx, id);
      if (c.estado === EstadoCotizacion.CONVERTIDA)
        throw new DomainError(`La cotización ${c.codigo} ya se convirtió en venta.`);
      if (!CONVERTIBLES.includes(c.estado))
        throw new DomainError(
          `La cotización ${c.codigo} está ${c.estado.toLowerCase()}: no se puede convertir.`,
        );
      const vencida = estaVencida(c);

      // Cliente
      let clienteId = opciones.clienteId ?? c.clienteId;
      if (!clienteId) {
        if (!c.clienteNombre || !c.clienteTelefono)
          throw new DomainError("Elegí el cliente de la venta.");
        try {
          clienteId = (
            await crearCliente(ctx, { nombre: c.clienteNombre, telefono: c.clienteTelefono }, tx)
          ).id;
        } catch (e) {
          if (!(e instanceof ClienteDuplicadoError)) throw e;
          clienteId = e.clienteExistente.id;
        }
      }

      // Precios: los cotizados, o los de hoy si está vencida y se pide recalcular.
      let precios = c.items.map((i) => ({
        varianteId: i.varianteId,
        cantidad: i.cantidad,
        precio: D(i.precioUnitario),
      }));
      if (vencida && opciones.recalcular) {
        const hoy = await calcularPrecios(
          ctx,
          {
            tipo: c.tipo,
            items: c.items.map((i) => ({ varianteId: i.varianteId, cantidad: i.cantidad })),
          },
          { puedeEditar: false },
          tx,
        );
        precios = hoy.items.map((i) => ({
          varianteId: i.varianteId,
          cantidad: i.cantidad,
          precio: D(i.precioUnitario),
        }));
      }
      const variantes = await tx.variante.findMany({
        where: { id: { in: precios.map((p) => p.varianteId) } },
        select: { id: true, precioVenta: true, producto: { select: { precioVenta: true } } },
      });
      const listaDe = new Map(variantes.map((v) => [v.id, D(precioVentaEfectivo(v, v.producto))]));
      const subtotal = precios.reduce((a, p) => a.plus(p.precio.mul(p.cantidad)), CERO);
      const descuento = Prisma.Decimal.min(c.descuento, subtotal);

      const venta = await generarVenta(
        ctx,
        {
          depositoId: opciones.depositoId,
          cliente: { id: clienteId },
          medioPago: opciones.medioPago,
          tipo: c.tipo === TipoCotizacion.MAYORISTA ? TipoVenta.MAYORISTA : TipoVenta.UNITARIA,
          descuento: descuento.greaterThan(0) ? descuento.toNumber() : undefined,
          notas: `Cotización ${c.codigo}`,
          items: precios.map((p) => {
            const lista = listaDe.get(p.varianteId);
            return {
              varianteId: p.varianteId,
              cantidad: p.cantidad,
              precioEspecial: lista && lista.equals(p.precio) ? undefined : p.precio.toNumber(),
            };
          }),
        },
        { puedeEditar: false, origen: "COTIZACION", cotizacionId: c.id },
        tx,
      );

      await tx.cotizacion.update({
        where: { id: c.id },
        data: { estado: EstadoCotizacion.CONVERTIDA, ventaId: venta.id, clienteId },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Cotizacion",
        entidadId: c.id,
        datosAntes: { estado: c.estado },
        datosDespues: {
          estado: EstadoCotizacion.CONVERTIDA,
          codigo: c.codigo,
          ventaId: venta.id,
          venta: venta.codigo,
          recalculada: Boolean(vencida && opciones.recalcular),
        },
        meta: ctx.meta,
      });
      return venta;
    },
    { maxRetries: 30, timeout: 30_000 },
  );
}
