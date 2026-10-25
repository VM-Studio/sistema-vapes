import "server-only";

import { AccionAuditoria, EstadoVenta, MedioPago, Prisma } from "@prisma/client";

import { finDelDia, inicioDelDia } from "@/lib/fechas";
import { numeroDeIdVenta } from "@/lib/paneles";
import {
  MAX_ARCHIVO_FACTURA_ML,
  TIPOS_ARCHIVO_FACTURA_ML,
  type CargarFacturaML,
  type EstadoFacturaML,
  type FiltrosVentasML,
} from "@/lib/validations/factura";
import { nombreConSabor } from "@/lib/ventas-ui";
import { dbPara, transaccion, type Ctx } from "@/server/db/panel-scoped";
import { DomainError, NotFoundError } from "@/server/errors";
import { detectarTipo } from "@/server/seguridad/archivos";
import { registrarAuditoria } from "@/server/services/audit.service";
import {
  claveAleatoria,
  claveDeUrl,
  obtenerStorage,
  type ExtensionArchivo,
} from "@/server/storage";

/**
 * FACTURAS DE VENTAS MERCADO LIBRE (por panel; cualquier panel que cobre por ML).
 *
 * - Una venta cobrada por Mercado Libre (Venta.medioPago = MERCADO_LIBRE, el
 *   medio principal) y CONFIRMADA aparece sola en Facturas → «Ventas Mercado
 *   Libre» desde que se registra: sin FacturaMercadoLibre está PENDIENTE de
 *   cargar; con fila, CARGADA. Las anuladas no aparecen.
 * - La factura se emite en ARCA por fuera del sistema; acá solo se marca como
 *   cargada con su fecha (default hoy), quién y, opcional, el archivo (PDF o
 *   imagen, en el storage privado). Una carga por venta; no se modifica.
 * - Permisos: FACTURAS "ver" (listado, archivo) y "editar" (cargar).
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dec = (d: Prisma.Decimal.Value | null | undefined) => D(d ?? 0).toFixed(2);

const EXTENSION: Record<(typeof TIPOS_ARCHIVO_FACTURA_ML)[number], ExtensionArchivo> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Ventas ML confirmadas del período (base de las tarjetas y del listado). */
function whereVentasML(f: Pick<FiltrosVentasML, "desde" | "hasta" | "q">): Prisma.VentaWhereInput {
  const where: Prisma.VentaWhereInput = {
    medioPago: MedioPago.MERCADO_LIBRE,
    estado: EstadoVenta.CONFIRMADA,
  };
  if (f.desde || f.hasta) {
    where.fecha = {
      ...(f.desde ? { gte: inicioDelDia(f.desde) } : {}),
      ...(f.hasta ? { lte: finDelDia(f.hasta) } : {}),
    };
  }
  const q = f.q?.trim();
  if (q) {
    const or: Prisma.VentaWhereInput[] = [
      { codigo: { contains: q, mode: "insensitive" } },
      { cliente: { nombre: { contains: q, mode: "insensitive" } } },
    ];
    const numero = numeroDeIdVenta(q);
    if (numero !== null) or.push({ numero });
    where.OR = or;
  }
  return where;
}

const conEstado = (estado: EstadoFacturaML): Prisma.VentaWhereInput =>
  estado === "CARGADA" ? { facturaML: { isNot: null } } : { facturaML: { is: null } };

export interface VentaMLListada {
  id: string;
  codigo: string;
  fecha: Date;
  cliente: { id: string; nombre: string };
  total: string;
  items: { titulo: string; cantidad: number; precioUnitario: string; subtotal: string }[];
  estado: EstadoFacturaML;
  factura: {
    fecha: Date;
    cargadaAt: Date;
    usuario: string;
    tieneArchivo: boolean;
    archivoNombre: string | null;
    archivoTipo: string | null;
  } | null;
}

export interface TotalesFacturasML {
  cargadas: { cantidad: number; total: string };
  pendientes: { cantidad: number; total: string };
}

/** Totales de las tarjetas: ventas ML con factura cargada y pendientes (período y búsqueda). */
export async function totalesFacturasML(
  ctx: Ctx,
  f: Pick<FiltrosVentasML, "desde" | "hasta" | "q"> = {},
): Promise<TotalesFacturasML> {
  const db = dbPara(ctx.panelId);
  const base = whereVentasML(f);
  const [cargadas, pendientes] = await Promise.all(
    (["CARGADA", "PENDIENTE"] as const).map((e) =>
      db.venta.aggregate({
        where: { AND: [base, conEstado(e)] },
        _count: true,
        _sum: { total: true },
      }),
    ),
  );
  return {
    cargadas: { cantidad: cargadas!._count, total: dec(cargadas!._sum.total) },
    pendientes: { cantidad: pendientes!._count, total: dec(pendientes!._sum.total) },
  };
}

/** Listado de ventas ML (más nuevas primero) con su estado de factura y las tarjetas. */
export async function listarVentasML(ctx: Ctx, f: FiltrosVentasML) {
  const db = dbPara(ctx.panelId);
  const where: Prisma.VentaWhereInput = f.estado
    ? { AND: [whereVentasML(f), conEstado(f.estado)] }
    : whereVentasML(f);
  const [total, filas, totales] = await Promise.all([
    db.venta.count({ where }),
    db.venta.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { numero: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true,
        codigo: true,
        fecha: true,
        total: true,
        cliente: { select: { id: true, nombre: true } },
        items: {
          orderBy: { id: "asc" },
          select: {
            cantidad: true,
            precioUnitario: true,
            subtotal: true,
            variante: { select: { nombre: true, producto: { select: { nombreCompleto: true } } } },
          },
        },
        facturaML: {
          select: {
            fecha: true,
            createdAt: true,
            archivoUrl: true,
            archivoNombre: true,
            archivoTipo: true,
            usuario: { select: { nombre: true } },
          },
        },
      },
    }),
    totalesFacturasML(ctx, f),
  ]);
  return {
    ventas: filas.map((v): VentaMLListada => ({
      id: v.id,
      codigo: v.codigo,
      fecha: v.fecha,
      cliente: v.cliente,
      total: dec(v.total),
      items: v.items.map((i) => ({
        titulo: nombreConSabor(i.variante.producto.nombreCompleto, i.variante.nombre),
        cantidad: i.cantidad,
        precioUnitario: dec(i.precioUnitario),
        subtotal: dec(i.subtotal),
      })),
      estado: v.facturaML ? "CARGADA" : "PENDIENTE",
      factura: v.facturaML
        ? {
            fecha: v.facturaML.fecha,
            cargadaAt: v.facturaML.createdAt,
            usuario: v.facturaML.usuario.nombre,
            tieneArchivo: v.facturaML.archivoUrl !== null,
            archivoNombre: v.facturaML.archivoNombre,
            archivoTipo: v.facturaML.archivoTipo,
          }
        : null,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
    totales,
  };
}

/** Nombre de archivo prolijo para guardar/descargar (sin rutas ni caracteres raros). */
function nombreLimpio(nombre: string | undefined, ext: string, codigo: string): string {
  const base = (nombre ?? "")
    .split(/[\\/]/)
    .pop()!
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, "")
    .trim()
    .slice(0, 120);
  return base || `factura-${codigo}.${ext}`;
}

/**
 * «Cargado»: marca la factura de una venta ML como cargada (fecha de la
 * factura, quién y, si viene, el archivo PDF o imagen). Una sola vez por venta.
 */
export async function marcarFacturaMLCargada(
  ctx: Ctx,
  input: CargarFacturaML,
  archivo?: { datos: Uint8Array; nombre?: string } | null,
): Promise<{ id: string; ventaId: string; codigo: string }> {
  const fecha = inicioDelDia(input.fecha);
  if (Number.isNaN(fecha.getTime())) throw new DomainError("Fecha inválida.");
  const db = dbPara(ctx.panelId);
  const venta = await db.venta.findUnique({
    where: { id: input.ventaId },
    select: {
      id: true,
      codigo: true,
      estado: true,
      medioPago: true,
      facturaML: { select: { id: true } },
    },
  });
  if (!venta) throw new NotFoundError("La venta no existe.");
  if (venta.medioPago !== MedioPago.MERCADO_LIBRE)
    throw new DomainError(`La venta ${venta.codigo} no se cobró por Mercado Libre.`);
  if (venta.estado !== EstadoVenta.CONFIRMADA)
    throw new DomainError(`La venta ${venta.codigo} está anulada.`);
  if (venta.facturaML)
    throw new DomainError(`La factura de la venta ${venta.codigo} ya está cargada.`);

  // Archivo opcional: PDF o imagen, validado por su contenido (no por la extensión).
  let guardado: { url: string; tipo: string; nombre: string; bytes: number } | null = null;
  if (archivo && archivo.datos.byteLength > 0) {
    if (archivo.datos.byteLength > MAX_ARCHIVO_FACTURA_ML)
      throw new DomainError("El archivo no puede pesar más de 5 MB.");
    const tipo = detectarTipo(archivo.datos);
    if (!tipo || !(TIPOS_ARCHIVO_FACTURA_ML as readonly string[]).includes(tipo))
      throw new DomainError("El archivo tiene que ser un PDF o una imagen (PNG, JPG o WebP).");
    const ext = EXTENSION[tipo];
    const clave = claveAleatoria("facturas-ml", `${ctx.panelId}-${venta.id}`, ext);
    const url = await obtenerStorage().guardar(clave, archivo.datos, tipo);
    guardado = {
      url,
      tipo,
      nombre: nombreLimpio(archivo.nombre, ext, venta.codigo),
      bytes: archivo.datos.byteLength,
    };
  }

  return transaccion(ctx, async (tx) => {
    // Bloqueo de la venta: dos «Cargado» a la vez → uno solo pasa (único por ventaId).
    await tx.$queryRaw`
      SELECT "id" FROM "Venta" WHERE "id" = ${venta.id} AND "panelId" = ${ctx.panelId} FOR UPDATE
    `;
    if (await tx.facturaMercadoLibre.findUnique({ where: { ventaId: venta.id } }))
      throw new DomainError(`La factura de la venta ${venta.codigo} ya está cargada.`);
    const f = await tx.facturaMercadoLibre.create({
      data: {
        ventaId: venta.id,
        fecha,
        archivoUrl: guardado?.url ?? null,
        archivoTipo: guardado?.tipo ?? null,
        archivoNombre: guardado?.nombre ?? null,
        usuarioId: ctx.usuarioId,
      },
      select: { id: true },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "FacturaMercadoLibre",
      entidadId: f.id,
      datosDespues: {
        ventaId: venta.id,
        venta: venta.codigo,
        fecha: input.fecha,
        ...(guardado
          ? {
              archivoUrl: guardado.url,
              archivoTipo: guardado.tipo,
              archivoNombre: guardado.nombre,
              bytes: guardado.bytes,
            }
          : { archivo: null }),
      },
      meta: ctx.meta,
    });
    return { id: f.id, ventaId: venta.id, codigo: venta.codigo };
  });
}

/** Archivo de la factura ML cargada de una venta (para ver o descargar). */
export async function archivoFacturaML(
  ctx: Ctx,
  ventaId: string,
): Promise<{ datos: Uint8Array; tipo: string; nombre: string }> {
  const f = await dbPara(ctx.panelId).facturaMercadoLibre.findUnique({
    where: { ventaId },
    select: {
      archivoUrl: true,
      archivoTipo: true,
      archivoNombre: true,
      venta: { select: { codigo: true } },
    },
  });
  if (!f?.archivoUrl) throw new NotFoundError("La factura no tiene archivo cargado.");
  const clave = claveDeUrl(f.archivoUrl);
  const archivo = clave ? await obtenerStorage().leer(clave) : null;
  if (!archivo) throw new NotFoundError("No se encontró el archivo de la factura.");
  return {
    datos: archivo.datos,
    tipo: f.archivoTipo ?? archivo.tipo,
    nombre: f.archivoNombre ?? `factura-${f.venta.codigo}`,
  };
}
