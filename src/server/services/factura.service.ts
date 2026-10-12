import "server-only";

import {
  AccionAuditoria,
  EstadoFactura,
  EstadoVenta,
  Prisma,
  type CondicionIva,
  type TipoFactura,
} from "@prisma/client";
import { PDFDocument, StandardFonts, type PDFFont, type PDFImage, type rgb } from "pdf-lib";

import { finDelDia, inicioDelDia } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { logosCandidatos, numeroDeIdVenta, prefijoPanel } from "@/lib/paneles";
import { ahora } from "@/lib/reloj";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import {
  calcularImportesFactura,
  CONDICION_IVA_LABEL,
  formatearCuit,
  formatearIdFactura,
  TIPO_FACTURA_LABEL,
  tiposPermitidos,
  type ConfigFacturacion,
  type DatosFiscales,
  type FacturarVenta,
  type FacturaSuelta,
  type FiltrosFacturas,
} from "@/lib/validations/factura";
import { nombreConSabor } from "@/lib/ventas-ui";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { siguienteNumero } from "@/server/db/secuencia";
import { DomainError, NotFoundError } from "@/server/errors";
import { emisorFiscal } from "@/server/facturacion/emisor";
import { aWinAnsi, cargarLogoPdf, COLOR_PDF, recortar, rectRedondeado } from "@/server/pdf";
import { clavePdf, pdfCacheado } from "@/server/pdf-http";
import type { Exportacion } from "@/server/reportes/exportar";
import { registrarAuditoria } from "@/server/services/audit.service";
import { obtenerConfigFacturacion } from "@/server/services/configuracion.service";
import { nombreNegocio } from "@/server/services/identidad.service";
import { claveDeUrl, obtenerStorage } from "@/server/storage";

/**
 * FACTURAS (por panel, si el panel tiene la facturación habilitada).
 *
 * - Se crean desde una venta confirmada (ítems, descuento y cliente de la
 *   venta) o sueltas (renglones a mano). Una venta tiene a lo sumo una
 *   factura EMITIDA; si se anula, se puede volver a facturar.
 * - Importes SIEMPRE del servidor (calcularImportesFactura): precios finales,
 *   IVA discriminado solo en la A con la alícuota del panel.
 * - Numeración propia por panel (Secuencia FACTURA): COS-F-000001. El número
 *   fiscal real (AFIP) es `numeroExterno` y se puede cargar después.
 * - El PDF es el que se sube (la factura real) o, si no hay, el comprobante
 *   que genera el sistema (interno: "Comprobante no válido como factura").
 * - Inmutables (trigger): solo se anulan (dueños), se les sube el PDF o se
 *   les carga el número externo.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dec = (d: Prisma.Decimal.Value) => D(d).toFixed(2);
const MAX_PDF = 10 * 1024 * 1024;

async function prefijoDelPanel(tx: Tx, ctx: Ctx): Promise<string> {
  const panel = await tx.panel.findUniqueOrThrow({
    where: { id: ctx.panelId },
    select: { slug: true },
  });
  return prefijoPanel(panel.slug);
}

async function exigirHabilitada(ctx: Ctx, tx: Tx): Promise<ConfigFacturacion> {
  const config = await obtenerConfigFacturacion(ctx, tx);
  if (!config.habilitada)
    throw new DomainError("Este panel no tiene la facturación habilitada (Ajustes → Facturación).");
  return config;
}

interface DatosNueva {
  tipo: TipoFactura;
  fecha: Date;
  ventaId: string | null;
  clienteId: string;
  datosFiscales: DatosFiscales;
  items: { varianteId: string | null; descripcion: string; cantidad: number; precio: string }[];
  descuento: string;
  numeroExterno?: string;
  observacion?: string;
}

async function crearEnTx(
  tx: Tx,
  ctx: Ctx,
  config: ConfigFacturacion,
  d: DatosNueva,
): Promise<{ id: string; codigo: string }> {
  if (!tiposPermitidos(config.condicionIva).includes(d.tipo)) {
    const condicion = config.condicionIva ? CONDICION_IVA_LABEL[config.condicionIva] : "";
    throw new DomainError(
      `Un negocio ${condicion.toLowerCase()} no emite ${TIPO_FACTURA_LABEL[d.tipo]}.`,
    );
  }
  const importes = calcularImportesFactura(
    d.tipo,
    d.items.map((i) => ({ cantidad: i.cantidad, precioUnitario: i.precio })),
    d.descuento,
    config.alicuotaIva,
  );
  const cliente = await tx.cliente.findFirst({
    where: { id: d.clienteId, deletedAt: null },
    select: { id: true, nombre: true },
  });
  if (!cliente) throw new NotFoundError("El cliente no existe o fue dado de baja.");
  const razonSocial = d.datosFiscales.razonSocial ?? cliente.nombre;
  const emision = await emisorFiscal().emitir({
    panelId: ctx.panelId,
    tipo: d.tipo,
    puntoVenta: config.puntoVenta,
    fecha: d.fecha,
    receptor: {
      razonSocial,
      cuit: d.datosFiscales.cuit ?? null,
      condicionIva: d.datosFiscales.condicionIva ?? null,
    },
    subtotal: importes.subtotal,
    alicuotaIva: importes.alicuotaIva,
    iva: importes.iva,
    total: importes.total,
  });
  const numero = await siguienteNumero(tx, ctx.panelId, "FACTURA");
  const codigo = formatearIdFactura(await prefijoDelPanel(tx, ctx), numero);
  const f = await tx.factura.create({
    data: {
      numero,
      codigo,
      tipo: d.tipo,
      puntoVenta: config.puntoVenta,
      numeroExterno: emision.numeroExterno ?? d.numeroExterno ?? null,
      fecha: d.fecha,
      ventaId: d.ventaId,
      clienteId: cliente.id,
      razonSocial,
      cuit: d.datosFiscales.cuit ?? null,
      condicionIva: d.datosFiscales.condicionIva ?? null,
      domicilio: d.datosFiscales.domicilio ?? null,
      descuento: importes.descuento,
      subtotal: importes.subtotal,
      alicuotaIva: importes.alicuotaIva,
      iva: importes.iva,
      total: importes.total,
      observacion: d.observacion ?? null,
      usuarioId: ctx.usuarioId,
      items: {
        create: d.items.map((i, orden) => ({
          varianteId: i.varianteId,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          precioUnitario: i.precio,
          subtotal: D(i.precio).mul(i.cantidad),
          orden,
        })),
      },
    },
    select: { id: true },
  });
  await registrarAuditoria(tx, {
    usuarioId: ctx.usuarioId,
    accion: AccionAuditoria.CREATE,
    entidad: "Factura",
    entidadId: f.id,
    datosDespues: {
      codigo,
      tipo: d.tipo,
      ventaId: d.ventaId,
      clienteId: cliente.id,
      ...importes,
      ...(d.numeroExterno ? { numeroExterno: d.numeroExterno } : {}),
    },
    meta: ctx.meta,
  });
  return { id: f.id, codigo };
}

const mapearUnico = (e: unknown): never => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    throw new DomainError(
      "Esa venta ya tiene una factura emitida: anulala para volver a facturar.",
    );
  throw e;
};

/** Factura de una venta confirmada: sus ítems (precio cobrado), su descuento y su cliente. */
export async function crearDesdeVenta(
  ctx: Ctx,
  input: FacturarVenta,
): Promise<{ id: string; codigo: string }> {
  return transaccion(
    ctx,
    async (tx) => {
      const config = await exigirHabilitada(ctx, tx);
      const v = await tx.venta.findUnique({
        where: { id: input.ventaId },
        select: {
          id: true,
          codigo: true,
          estado: true,
          clienteId: true,
          descuento: true,
          items: {
            orderBy: { createdAt: "asc" },
            select: {
              varianteId: true,
              cantidad: true,
              precioUnitario: true,
              variante: {
                select: { nombre: true, producto: { select: { nombreCompleto: true } } },
              },
            },
          },
          facturas: { where: { estado: EstadoFactura.EMITIDA }, select: { codigo: true } },
        },
      });
      if (!v) throw new NotFoundError("La venta no existe en este panel.");
      if (v.estado !== EstadoVenta.CONFIRMADA)
        throw new DomainError(`La venta ${v.codigo} está anulada: no se factura.`);
      if (v.facturas[0])
        throw new DomainError(
          `La venta ${v.codigo} ya tiene la factura ${v.facturas[0].codigo}: anulala para volver a facturar.`,
        );
      return crearEnTx(tx, ctx, config, {
        tipo: input.tipo,
        fecha: ahora(),
        ventaId: v.id,
        clienteId: v.clienteId,
        datosFiscales: input.datosFiscales,
        items: v.items.map((i) => ({
          varianteId: i.varianteId,
          descripcion: nombreConSabor(i.variante.producto.nombreCompleto, i.variante.nombre),
          cantidad: i.cantidad,
          precio: dec(i.precioUnitario),
        })),
        descuento: dec(v.descuento),
        numeroExterno: input.numeroExterno,
        observacion: input.observacion,
      });
    },
    { maxRetries: 10, timeout: 30_000 },
  ).catch(mapearUnico);
}

/** Factura sin venta (servicios, ventas anteriores al sistema…): renglones a mano. */
export async function crearSuelta(
  ctx: Ctx,
  input: FacturaSuelta,
): Promise<{ id: string; codigo: string }> {
  return transaccion(
    ctx,
    async (tx) => {
      const config = await exigirHabilitada(ctx, tx);
      return crearEnTx(tx, ctx, config, {
        tipo: input.tipo,
        fecha: input.fecha ? inicioDelDia(input.fecha) : ahora(),
        ventaId: null,
        clienteId: input.clienteId,
        datosFiscales: input.datosFiscales,
        items: input.items.map((i) => ({
          varianteId: null,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          precio: D(i.precioUnitario).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
        })),
        descuento: dec(input.descuento ?? 0),
        numeroExterno: input.numeroExterno,
        observacion: input.observacion,
      });
    },
    { maxRetries: 10, timeout: 30_000 },
  );
}

/** Anula una factura emitida (solo dueños: lo decide la acción). */
export async function anular(
  ctx: Ctx,
  id: string,
  motivo: string,
): Promise<{ id: string; codigo: string }> {
  return transaccion(ctx, async (tx) => {
    const f = await tx.factura.findUnique({
      where: { id },
      select: { id: true, codigo: true, estado: true },
    });
    if (!f) throw new NotFoundError("La factura no existe.");
    if (f.estado === EstadoFactura.ANULADA)
      throw new DomainError(`La factura ${f.codigo} ya está anulada.`);
    await tx.factura.update({
      where: { id },
      data: {
        estado: EstadoFactura.ANULADA,
        anuladaPorId: ctx.usuarioId,
        anuladaAt: ahora(),
        motivoAnulacion: motivo.trim(),
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Factura",
      entidadId: id,
      datosAntes: { estado: EstadoFactura.EMITIDA },
      datosDespues: { estado: EstadoFactura.ANULADA, codigo: f.codigo, motivo: motivo.trim() },
      meta: ctx.meta,
    });
    return { id, codigo: f.codigo };
  });
}

/** Número fiscal real (el que asignó AFIP al emitirla por fuera). */
export async function registrarNumeroExterno(
  ctx: Ctx,
  id: string,
  numeroExterno: string | undefined,
): Promise<{ id: string }> {
  return transaccion(ctx, async (tx) => {
    const f = await tx.factura.findUnique({
      where: { id },
      select: { codigo: true, estado: true, numeroExterno: true },
    });
    if (!f) throw new NotFoundError("La factura no existe.");
    if (f.estado === EstadoFactura.ANULADA)
      throw new DomainError(`La factura ${f.codigo} está anulada.`);
    await tx.factura.update({ where: { id }, data: { numeroExterno: numeroExterno ?? null } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Factura",
      entidadId: id,
      datosAntes: { numeroExterno: f.numeroExterno },
      datosDespues: { numeroExterno: numeroExterno ?? null },
      meta: ctx.meta,
    });
    return { id };
  });
}

/** Sube el PDF real de la factura (el que se emitió por fuera). Reemplaza al generado. */
export async function subirArchivo(
  ctx: Ctx,
  id: string,
  pdf: Uint8Array,
): Promise<{ id: string; archivoUrl: string }> {
  if (pdf.byteLength === 0) throw new DomainError("El archivo está vacío.");
  if (pdf.byteLength > MAX_PDF) throw new DomainError("El PDF no puede pesar más de 10 MB.");
  if (Buffer.from(pdf.subarray(0, 5)).toString("latin1") !== "%PDF-")
    throw new DomainError("El archivo no es un PDF.");
  const f = await dbPara(ctx.panelId).factura.findUnique({
    where: { id },
    select: { codigo: true, estado: true },
  });
  if (!f) throw new NotFoundError("La factura no existe.");
  if (f.estado === EstadoFactura.ANULADA)
    throw new DomainError(`La factura ${f.codigo} está anulada.`);
  const clave = `facturas/${ctx.panelId}/${id}-${Date.now()}.pdf`;
  const archivoUrl = await obtenerStorage().guardar(clave, pdf, "application/pdf");
  return transaccion(ctx, async (tx) => {
    await tx.factura.update({ where: { id }, data: { archivoUrl } });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Factura",
      entidadId: id,
      datosDespues: { archivoUrl, bytes: pdf.byteLength },
      meta: ctx.meta,
    });
    return { id, archivoUrl };
  });
}

// =============================================================================
// Lectura
// =============================================================================

function whereFacturas(f: Omit<FiltrosFacturas, "page" | "pageSize">): Prisma.FacturaWhereInput {
  const where: Prisma.FacturaWhereInput = {};
  if (f.tipo) where.tipo = f.tipo;
  if (f.estado) where.estado = f.estado;
  if (f.desde || f.hasta) {
    where.fecha = {
      ...(f.desde ? { gte: inicioDelDia(f.desde) } : {}),
      ...(f.hasta ? { lte: finDelDia(f.hasta) } : {}),
    };
  }
  const q = f.q?.trim();
  if (q) {
    const or: Prisma.FacturaWhereInput[] = [
      { codigo: { contains: q, mode: "insensitive" } },
      { numeroExterno: { contains: q, mode: "insensitive" } },
      { razonSocial: { contains: q, mode: "insensitive" } },
      { cliente: { nombre: { contains: q, mode: "insensitive" } } },
      { venta: { codigo: { contains: q, mode: "insensitive" } } },
    ];
    const numeroVenta = numeroDeIdVenta(q);
    if (numeroVenta !== null) or.push({ venta: { numero: numeroVenta } });
    where.OR = or;
  }
  return where;
}

export interface FacturaListada {
  id: string;
  codigo: string;
  tipo: TipoFactura;
  numeroExterno: string | null;
  fecha: Date;
  cliente: { id: string; nombre: string };
  razonSocial: string | null;
  venta: { id: string; codigo: string } | null;
  total: string;
  estado: EstadoFactura;
  tieneArchivo: boolean;
}

export async function listar(ctx: Ctx, f: FiltrosFacturas) {
  const db = dbPara(ctx.panelId);
  const where = whereFacturas(f);
  const [total, filas, agregado] = await Promise.all([
    db.factura.count({ where }),
    db.factura.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        cliente: { select: { id: true, nombre: true } },
        venta: { select: { id: true, codigo: true } },
      },
    }),
    db.factura.aggregate({
      where: { AND: [where, { estado: EstadoFactura.EMITIDA }] },
      _count: true,
      _sum: { total: true, iva: true },
    }),
  ]);
  return {
    facturas: filas.map((x): FacturaListada => ({
      id: x.id,
      codigo: x.codigo,
      tipo: x.tipo,
      numeroExterno: x.numeroExterno,
      fecha: x.fecha,
      cliente: x.cliente,
      razonSocial: x.razonSocial,
      venta: x.venta,
      total: dec(x.total),
      estado: x.estado,
      tieneArchivo: x.archivoUrl !== null,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
    resumen: {
      cantidad: agregado._count,
      total: dec(agregado._sum.total ?? 0),
      iva: dec(agregado._sum.iva ?? 0),
    },
  };
}

export async function obtener(ctx: Ctx, id: string) {
  const f = await dbPara(ctx.panelId).factura.findUnique({
    where: { id },
    include: {
      cliente: { select: { id: true, nombre: true, telefono: true } },
      venta: { select: { id: true, codigo: true, fecha: true, total: true } },
      usuario: { select: { nombre: true } },
      anuladaPor: { select: { nombre: true } },
      items: { orderBy: { orden: "asc" } },
    },
  });
  if (!f) throw new NotFoundError("La factura no existe.");
  return {
    id: f.id,
    numero: f.numero,
    codigo: f.codigo,
    tipo: f.tipo,
    puntoVenta: f.puntoVenta,
    numeroExterno: f.numeroExterno,
    fecha: f.fecha,
    cliente: f.cliente,
    venta: f.venta ? { ...f.venta, total: dec(f.venta.total) } : null,
    razonSocial: f.razonSocial,
    cuit: f.cuit,
    condicionIva: f.condicionIva as CondicionIva | null,
    domicilio: f.domicilio,
    descuento: dec(f.descuento),
    subtotal: dec(f.subtotal),
    alicuotaIva: dec(f.alicuotaIva),
    iva: dec(f.iva),
    total: dec(f.total),
    estado: f.estado,
    tieneArchivo: f.archivoUrl !== null,
    observacion: f.observacion,
    usuario: f.usuario.nombre,
    anulacion: f.anuladaAt
      ? { por: f.anuladaPor?.nombre ?? "", at: f.anuladaAt, motivo: f.motivoAnulacion }
      : null,
    items: f.items.map((i) => ({
      id: i.id,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: dec(i.precioUnitario),
      subtotal: dec(i.subtotal),
    })),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    archivoUrl: f.archivoUrl,
  };
}

export type FacturaDetalle = Awaited<ReturnType<typeof obtener>>;

/** Facturas de una venta (la emitida primero): el detalle de la venta las enlaza. */
export async function facturasDeVenta(ctx: Ctx, ventaId: string) {
  const filas = await dbPara(ctx.panelId).factura.findMany({
    where: { ventaId },
    orderBy: [{ estado: "asc" }, { fecha: "desc" }],
    select: { id: true, codigo: true, tipo: true, estado: true },
  });
  return filas;
}

/** Venta para facturar (buscador por ID en «Nueva factura»). */
export async function ventaParaFacturar(ctx: Ctx, texto: string) {
  const numero = numeroDeIdVenta(texto);
  if (numero === null) return null;
  const v = await dbPara(ctx.panelId).venta.findFirst({
    where: { numero },
    select: {
      id: true,
      codigo: true,
      fecha: true,
      estado: true,
      total: true,
      cliente: { select: { id: true, nombre: true } },
      items: { select: { cantidad: true } },
      facturas: { where: { estado: EstadoFactura.EMITIDA }, select: { id: true, codigo: true } },
    },
  });
  if (!v) return null;
  return {
    id: v.id,
    codigo: v.codigo,
    fecha: v.fecha,
    anulada: v.estado === EstadoVenta.ANULADA,
    total: dec(v.total),
    cliente: v.cliente,
    unidades: v.items.reduce((a, i) => a + i.cantidad, 0),
    factura: v.facturas[0] ?? null,
  };
}

export type VentaParaFacturar = NonNullable<Awaited<ReturnType<typeof ventaParaFacturar>>>;

// =============================================================================
// PDF
// =============================================================================

/**
 * PDF de la factura para `GET /api/p/{slug}/facturas/{id}/pdf`: el subido (la
 * factura real) si hay y no se pide `generado`; si no, el comprobante del
 * sistema, cacheado con la firma de lo que dibuja.
 */
export async function pdfFactura(
  ctx: Ctx,
  id: string,
  opciones: { generado?: boolean } = {},
): Promise<{ pdf: Uint8Array; archivo: string }> {
  const f = await obtener(ctx, id);
  if (f.archivoUrl && !opciones.generado) {
    const clave = claveDeUrl(f.archivoUrl);
    const archivo = clave ? await obtenerStorage().leer(clave) : null;
    if (archivo) return { pdf: archivo.datos, archivo: `factura-${f.codigo}.pdf` };
  }
  const db = dbPara(ctx.panelId);
  const [panel, config, negocio] = await Promise.all([
    db.panel.findUniqueOrThrow({
      where: { id: ctx.panelId },
      select: { nombre: true, slug: true, logoUrl: true },
    }),
    obtenerConfigFacturacion(ctx),
    nombreNegocio(),
  ]);
  const clave = clavePdf("factura", ctx.panelId, id, { v: 1, f, panel, config, negocio });
  const pdf = await pdfCacheado(clave, () => dibujarFactura(f, panel, config, negocio));
  return { pdf, archivo: `factura-${f.codigo}.pdf` };
}

async function dibujarFactura(
  f: FacturaDetalle,
  panel: { nombre: string; slug: string; logoUrl: string | null },
  config: ConfigFacturacion,
  negocio: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${TIPO_FACTURA_LABEL[f.tipo]} ${f.codigo}`);
  doc.setCreator(negocio);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  for (const url of logosCandidatos(panel.slug, panel.logoUrl)) {
    logo = await cargarLogoPdf(doc, url);
    if (logo) break;
  }

  // A4 vertical.
  const ANCHO = 595.28;
  const ALTO = 841.89;
  const M = 40;
  const util = ANCHO - 2 * M;
  const negro = COLOR_PDF.texto;
  const gris = COLOR_PDF.muted;
  const linea = COLOR_PDF.borde;
  let page = doc.addPage([ANCHO, ALTO]);
  let y = ALTO - M;

  const texto = (
    s: string,
    x: number,
    yy: number,
    opts: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      derecha?: boolean;
      centro?: boolean;
      max?: number;
    } = {},
  ) => {
    const font = opts.font ?? normal;
    const size = opts.size ?? 9;
    let w = aWinAnsi(s, font);
    if (opts.max) w = recortar(w, font, size, opts.max);
    const ancho = font.widthOfTextAtSize(w, size);
    const dx = opts.derecha ? ancho : opts.centro ? ancho / 2 : 0;
    page.drawText(w, { x: x - dx, y: yy, size, font, color: opts.color ?? negro });
  };
  const raya = (yy: number, grosor = 0.4) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: ANCHO - M, y: yy },
      thickness: grosor,
      color: linea,
    });

  // Cabecera: emisor a la izquierda, letra al centro, comprobante a la derecha.
  const ALTO_CAB = 96;
  const medio = ANCHO / 2;
  if (logo) {
    const escala = Math.min(150 / logo.width, 42 / logo.height);
    page.drawImage(logo, {
      x: M,
      y: y - 42,
      width: logo.width * escala,
      height: logo.height * escala,
    });
  } else {
    texto(panel.nombre, M, y - 26, { size: 16, font: negrita });
  }
  const emisor = [
    config.razonSocial ?? negocio,
    ...(config.cuit ? [`CUIT ${formatearCuit(config.cuit)}`] : []),
    ...(config.condicionIva ? [CONDICION_IVA_LABEL[config.condicionIva]] : []),
    ...(config.domicilio ? [config.domicilio] : []),
  ];
  emisor.forEach((l, i) =>
    texto(l, M, y - 56 - i * 11, {
      size: i === 0 ? 9.5 : 8,
      font: i === 0 ? negrita : normal,
      color: i === 0 ? negro : gris,
      max: medio - M - 40,
    }),
  );
  const letra = f.tipo === "COMPROBANTE_INTERNO" ? "X" : f.tipo;
  rectRedondeado(page, medio - 22, y - 46, 44, 44, 6, COLOR_PDF.card);
  texto(letra, medio, y - 34, { size: 26, font: negrita, centro: true });
  texto(
    f.tipo === "COMPROBANTE_INTERNO" ? "Comprobante interno" : TIPO_FACTURA_LABEL[f.tipo],
    ANCHO - M,
    y - 14,
    { size: 14, font: negrita, derecha: true },
  );
  texto(`N° ${f.codigo}`, ANCHO - M, y - 30, { size: 10, derecha: true });
  if (f.numeroExterno)
    texto(`Número fiscal ${f.numeroExterno}`, ANCHO - M, y - 43, {
      size: 8.5,
      color: gris,
      derecha: true,
    });
  texto(`Punto de venta ${String(f.puntoVenta).padStart(4, "0")}`, ANCHO - M, y - 56, {
    size: 8.5,
    color: gris,
    derecha: true,
  });
  texto(`Fecha ${formatearFecha(f.fecha)}`, ANCHO - M, y - 68, {
    size: 8.5,
    color: gris,
    derecha: true,
  });
  y -= ALTO_CAB;
  raya(y, 0.6);
  y -= 22;

  if (f.estado === EstadoFactura.ANULADA) {
    rectRedondeado(page, M, y - 34, util, 34, 6, COLOR_PDF.card);
    texto("COMPROBANTE ANULADO", M + 12, y - 15, {
      size: 11,
      font: negrita,
      color: COLOR_PDF.baja,
    });
    texto(f.anulacion?.motivo ?? "", M + 12, y - 27, { size: 8, color: gris, max: util - 24 });
    y -= 46;
  }

  // Receptor.
  const receptor: [string, string][] = [
    ["Cliente", f.razonSocial ?? f.cliente.nombre],
    ...(f.cuit ? ([["CUIT", formatearCuit(f.cuit)]] as [string, string][]) : []),
    ...(f.condicionIva
      ? ([["Condición IVA", CONDICION_IVA_LABEL[f.condicionIva]]] as [string, string][])
      : []),
    ...(f.domicilio ? ([["Domicilio", f.domicilio]] as [string, string][]) : []),
    ...(f.venta ? ([["Venta", f.venta.codigo]] as [string, string][]) : []),
  ];
  const altoReceptor = receptor.length * 14 + 12;
  rectRedondeado(page, M, y - altoReceptor, util, altoReceptor, 6, COLOR_PDF.card);
  let yy = y - 17;
  for (const [etiqueta, valor] of receptor) {
    texto(etiqueta, M + 12, yy, { size: 8, color: gris });
    texto(valor, M + 110, yy, { size: 9.5, max: util - 122 });
    yy -= 14;
  }
  y -= altoReceptor + 24;

  // Ítems.
  const xCant = M;
  const xDesc = M + 44;
  const xPrecio = ANCHO - M - 100;
  const xSub = ANCHO - M;
  const enc = { font: negrita, size: 7.5, color: gris };
  const encabezado = () => {
    texto("Cant.", xCant, y, enc);
    texto("Descripción", xDesc, y, enc);
    texto("Precio unit.", xPrecio, y, { ...enc, derecha: true });
    texto("Subtotal", xSub, y, { ...enc, derecha: true });
    y -= 8;
    raya(y);
    y -= 14;
  };
  encabezado();
  for (const i of f.items) {
    if (y < M + 120) {
      page = doc.addPage([ANCHO, ALTO]);
      y = ALTO - M;
      encabezado();
    }
    texto(String(i.cantidad), xCant, y, { size: 9 });
    texto(i.descripcion, xDesc, y, { size: 9, max: xPrecio - xDesc - 70 });
    texto(formatearPesos(i.precioUnitario), xPrecio, y, { size: 9, derecha: true });
    texto(formatearPesos(i.subtotal), xSub, y, { size: 9, derecha: true });
    y -= 8;
    raya(y);
    y -= 14;
  }

  // Totales.
  y -= 6;
  const fila = (etiqueta: string, valor: string, fuerte = false) => {
    texto(etiqueta, xPrecio - 60, y, { size: fuerte ? 11 : 9, font: fuerte ? negrita : normal });
    texto(valor, xSub, y, {
      size: fuerte ? 13 : 9.5,
      font: fuerte ? negrita : normal,
      derecha: true,
    });
    y -= fuerte ? 20 : 15;
  };
  if (Number(f.descuento) > 0) fila("Descuento", `−${formatearPesos(f.descuento)}`);
  if (f.tipo === "A") {
    fila("Neto gravado", formatearPesos(f.subtotal));
    fila(`IVA ${Number(f.alicuotaIva).toLocaleString("es-AR")}%`, formatearPesos(f.iva));
  } else if (f.tipo === "B") {
    texto("IVA incluido en los precios", M, y, { size: 8, color: gris });
  }
  fila("Total", formatearPesos(f.total), true);

  if (f.observacion) {
    y -= 6;
    texto("Observaciones", M, y, { size: 8, font: negrita, color: gris });
    y -= 12;
    texto(f.observacion, M, y, { size: 8.5, max: util });
    y -= 16;
  }

  // Leyenda y pie.
  for (const p of doc.getPages()) {
    if (f.tipo === "COMPROBANTE_INTERNO") {
      const leyenda = aWinAnsi("Comprobante no válido como factura", negrita);
      p.drawText(leyenda, {
        x: ANCHO / 2 - negrita.widthOfTextAtSize(leyenda, 10) / 2,
        y: M + 18,
        size: 10,
        font: negrita,
        color: COLOR_PDF.baja,
      });
    }
    p.drawLine({
      start: { x: M, y: M + 4 },
      end: { x: ANCHO - M, y: M + 4 },
      thickness: 0.4,
      color: linea,
    });
    const s = aWinAnsi(
      `${TIPO_FACTURA_LABEL[f.tipo]} ${f.codigo} · ${negocio} · ${formatearFechaHora(f.createdAt)}`,
      normal,
    );
    p.drawText(s, {
      x: ANCHO - M - normal.widthOfTextAtSize(s, 7),
      y: M - 8,
      size: 7,
      font: normal,
      color: COLOR_PDF.subtle,
    });
  }
  return doc.save();
}

// =============================================================================
// Exportación para el contador
// =============================================================================

export async function exportarFacturas(ctx: Ctx, f: FiltrosFacturas): Promise<Exportacion> {
  const filas = await dbPara(ctx.panelId).factura.findMany({
    where: whereFacturas(f),
    orderBy: [{ fecha: "asc" }, { numero: "asc" }],
    take: 10_000,
    include: { cliente: { select: { nombre: true } }, venta: { select: { codigo: true } } },
  });
  const emitidas = filas.filter((x) => x.estado === EstadoFactura.EMITIDA);
  const suma = (k: "subtotal" | "iva" | "total") =>
    emitidas.reduce((a, x) => a.plus(x[k]), D(0)).toNumber();
  const periodo =
    f.desde || f.hasta
      ? `${f.desde ? formatearFecha(inicioDelDia(f.desde)) : "…"} al ${f.hasta ? formatearFecha(inicioDelDia(f.hasta)) : "…"}`
      : "Todas";
  return {
    titulo: "Facturas",
    archivo: "facturas",
    periodo,
    filtros: [
      ...(f.tipo ? [`Tipo: ${TIPO_FACTURA_LABEL[f.tipo]}`] : []),
      ...(f.estado ? [`Estado: ${f.estado === "EMITIDA" ? "Emitidas" : "Anuladas"}`] : []),
    ],
    apaisado: true,
    tablas: [
      {
        columnas: [
          { titulo: "Fecha", ancho: 1 },
          { titulo: "Número", ancho: 1.3 },
          { titulo: "Tipo", ancho: 1.2 },
          { titulo: "Pto. venta", tipo: "numero" },
          { titulo: "Número fiscal", ancho: 1.3 },
          { titulo: "Cliente / razón social", ancho: 2.2 },
          { titulo: "CUIT", ancho: 1.3 },
          { titulo: "Condición IVA", ancho: 1.4 },
          { titulo: "Venta", ancho: 1.1 },
          { titulo: "Neto", tipo: "moneda" },
          { titulo: "IVA", tipo: "moneda" },
          { titulo: "Total", tipo: "moneda" },
          { titulo: "Estado", ancho: 0.9 },
        ],
        filas: filas.map((x) => [
          formatearFecha(x.fecha),
          x.codigo,
          TIPO_FACTURA_LABEL[x.tipo],
          x.puntoVenta,
          x.numeroExterno ?? "",
          x.razonSocial ?? x.cliente.nombre,
          x.cuit ? formatearCuit(x.cuit) : "",
          x.condicionIva ? CONDICION_IVA_LABEL[x.condicionIva] : "",
          x.venta?.codigo ?? "",
          Number(x.subtotal),
          Number(x.iva),
          Number(x.total),
          x.estado === EstadoFactura.EMITIDA ? "Emitida" : "Anulada",
        ]),
        totales: [
          "Total emitidas",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          suma("subtotal"),
          suma("iva"),
          suma("total"),
          "",
        ],
      },
    ],
  };
}
