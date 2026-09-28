import "server-only";

import bwipjs from "bwip-js/node";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { aWinAnsi, MM, recortar } from "@/server/pdf";
import { formatearPesos } from "@/lib/format";
import type { FormatoEtiqueta, PedidoEtiquetas } from "@/lib/validations/etiquetas";
import { DomainError } from "@/server/errors";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";
import {
  asignarCodigosInternos,
  esCodigoInterno,
  nombreCompleto,
  prefijoCodigoInterno,
} from "@/server/services/producto.service";

/**
 * Etiquetas Code128 para imprimir (productos sin código de fábrica, o para
 * re-etiquetar). bwip-js dibuja el código (PNG, con zona blanca) y pdf-lib
 * arma el PDF en el formato elegido. Todo del lado del servidor y dentro del
 * panel del ctx (los códigos internos son únicos por panel).
 */

const MAX_ETIQUETAS = 2000;

interface Plantilla {
  pagina: { ancho: number; alto: number }; // mm
  columnas: number;
  filas: number;
  etiqueta: { ancho: number; alto: number }; // mm
  margen: { izquierda: number; arriba: number }; // mm
  paso: { horizontal: number; vertical: number }; // mm entre orígenes de etiquetas
}

const A4 = { ancho: 210, alto: 297 };

export const PLANTILLAS: Record<FormatoEtiqueta, Plantilla> = {
  // Avery / L7651: 5 × 13 de 38,1 × 21,2 mm.
  avery65: {
    pagina: A4,
    columnas: 5,
    filas: 13,
    etiqueta: { ancho: 38.1, alto: 21.2 },
    margen: { izquierda: 4.65, arriba: 10.7 },
    paso: { horizontal: 40.64, vertical: 21.2 },
  },
  // 3 × 8 de 70 × 37 mm (hoja completa, sin márgenes).
  a4_3x8: {
    pagina: A4,
    columnas: 3,
    filas: 8,
    etiqueta: { ancho: 70, alto: 37 },
    margen: { izquierda: 0, arriba: 0.5 },
    paso: { horizontal: 70, vertical: 37 },
  },
  // Avery L7163: 2 × 7 de 99,1 × 38,1 mm.
  a4_2x7: {
    pagina: A4,
    columnas: 2,
    filas: 7,
    etiqueta: { ancho: 99.1, alto: 38.1 },
    margen: { izquierda: 4.65, arriba: 15.15 },
    paso: { horizontal: 101.6, vertical: 38.1 },
  },
  // Rollo térmico: una etiqueta de 50 × 30 mm por página.
  rollo50x30: {
    pagina: { ancho: 50, alto: 30 },
    columnas: 1,
    filas: 1,
    etiqueta: { ancho: 50, alto: 30 },
    margen: { izquierda: 0, arriba: 0 },
    paso: { horizontal: 50, vertical: 30 },
  },
};

export interface VarianteParaEtiqueta {
  varianteId: string;
  nombreCompleto: string;
  sku: string;
  codigoBarras: string | null;
  precioVenta: string;
  /** Sin código de fábrica: sin código o con un código interno generado por el sistema. */
  sinCodigoDeFabrica: boolean;
}

/** Para la pantalla de impresión: buscar por texto, por producto o "todas sin código de fábrica". */
export async function listarVariantesParaEtiquetas(
  ctx: Pick<Ctx, "panelId">,
  filtro: {
    q?: string;
    productoId?: string;
    soloSinCodigoDeFabrica?: boolean;
  },
): Promise<VarianteParaEtiqueta[]> {
  const q = filtro.q?.trim();
  const [prefijo, filas] = await Promise.all([
    prefijoCodigoInterno(ctx),
    dbPara(ctx.panelId).variante.findMany({
      where: {
        deletedAt: null,
        producto: { deletedAt: null, ...(filtro.productoId ? { id: filtro.productoId } : {}) },
        ...(q
          ? {
              OR: [
                { nombre: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { codigoBarras: { contains: q.toUpperCase() } },
                { producto: { nombre: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: [{ producto: { nombre: "asc" } }, { nombre: "asc" }],
      take: 500,
      select: {
        id: true,
        nombre: true,
        sku: true,
        codigoBarras: true,
        precioVenta: true,
        producto: { select: { nombre: true, tieneVariantes: true } },
      },
    }),
  ]);
  const resultado: VarianteParaEtiqueta[] = [];
  for (const v of filas) {
    const sinCodigoDeFabrica = v.codigoBarras === null || esCodigoInterno(v.codigoBarras, prefijo);
    if (filtro.soloSinCodigoDeFabrica && !sinCodigoDeFabrica) continue;
    resultado.push({
      varianteId: v.id,
      nombreCompleto: nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes),
      sku: v.sku,
      codigoBarras: v.codigoBarras,
      precioVenta: v.precioVenta.toFixed(2),
      sinCodigoDeFabrica,
    });
  }
  return resultado;
}

/** PNG del Code128 (con zona blanca de 10 módulos a cada lado, que los lectores necesitan). */
export async function renderizarCode128(codigo: string): Promise<Uint8Array> {
  return bwipjs.toBuffer({
    bcid: "code128",
    text: codigo,
    scale: 4,
    height: 12,
    includetext: false,
    paddingwidth: 10,
    paddingheight: 2,
    backgroundcolor: "FFFFFF",
  });
}

function dibujarEtiqueta(
  page: PDFPage,
  x: number, // pt, esquina inferior izquierda
  y: number,
  plantilla: Plantilla,
  datos: { nombre: string; codigo: string; precio: string | null },
  imagen: PDFImage,
  fuentes: { normal: PDFFont; negrita: PDFFont },
) {
  const w = plantilla.etiqueta.ancho * MM;
  const h = plantilla.etiqueta.alto * MM;
  const pad = Math.min(2, plantilla.etiqueta.alto * 0.08) * MM;
  const chica = plantilla.etiqueta.alto < 25;
  const tamNombre = chica ? 5.5 : 7.5;
  const tamCodigo = chica ? 5.5 : 7;
  const tamPrecio = chica ? 7 : 10;
  const anchoUtil = w - 2 * pad;

  // Arriba: nombre (izquierda) y precio (derecha).
  let anchoNombre = anchoUtil;
  const yTexto = y + h - pad - tamPrecio * 0.85;
  if (datos.precio) {
    const precio = aWinAnsi(datos.precio, fuentes.negrita);
    const anchoPrecio = fuentes.negrita.widthOfTextAtSize(precio, tamPrecio);
    page.drawText(precio, {
      x: x + w - pad - anchoPrecio,
      y: yTexto,
      size: tamPrecio,
      font: fuentes.negrita,
      color: rgb(0, 0, 0),
    });
    anchoNombre -= anchoPrecio + 2 * MM;
  }
  const nombre = recortar(
    aWinAnsi(datos.nombre, fuentes.normal),
    fuentes.normal,
    tamNombre,
    anchoNombre,
  );
  page.drawText(nombre, {
    x: x + pad,
    y: yTexto,
    size: tamNombre,
    font: fuentes.normal,
    color: rgb(0, 0, 0),
  });

  // Abajo: el código en texto.
  const codigo = aWinAnsi(datos.codigo, fuentes.normal);
  const anchoCodigo = fuentes.normal.widthOfTextAtSize(codigo, tamCodigo);
  page.drawText(codigo, {
    x: x + (w - anchoCodigo) / 2,
    y: y + pad,
    size: tamCodigo,
    font: fuentes.normal,
    color: rgb(0, 0, 0),
  });

  // Al medio: las barras (escaladas de forma uniforme a lo ancho: la proporción entre barras se mantiene).
  const arriba = yTexto - 1.2 * MM;
  const abajo = y + pad + tamCodigo + 0.8 * MM;
  const altoBarras = Math.max(4 * MM, arriba - abajo);
  // Ancho completo de la etiqueta, con tope de 0,5 mm por módulo (el PNG es de 4 px por módulo).
  const modulos = imagen.width / 4;
  const anchoBarras = Math.min(anchoUtil, modulos * 0.5 * MM);
  page.drawImage(imagen, {
    x: x + (w - anchoBarras) / 2,
    y: abajo,
    width: anchoBarras,
    height: altoBarras,
  });
}

/**
 * Genera el PDF. A las variantes sin código se les asigna un código interno
 * (requiere permiso de edición en Productos: lo decide la capa de acción).
 */
export async function generarPdfEtiquetas(
  ctx: Ctx,
  pedido: PedidoEtiquetas,
  opciones: { puedeGenerarCodigos: boolean },
): Promise<{ pdf: Uint8Array; etiquetas: number; codigosGenerados: number }> {
  const total = pedido.items.reduce((a, i) => a + i.cantidad, 0);
  if (total > MAX_ETIQUETAS)
    throw new DomainError(`Máximo ${MAX_ETIQUETAS} etiquetas por PDF (pediste ${total}).`);

  const db = dbPara(ctx.panelId);
  const ids = pedido.items.map((i) => i.varianteId);
  const sinCodigo = await db.variante.count({
    where: { id: { in: ids }, deletedAt: null, codigoBarras: null },
  });
  let codigosGenerados = 0;
  if (sinCodigo > 0) {
    if (!opciones.puedeGenerarCodigos) {
      throw new DomainError(
        `${sinCodigo} producto(s) no tienen código de barras y no tenés permiso para generarlos.`,
      );
    }
    codigosGenerados = (await asignarCodigosInternos(ctx, ids)).asignados.length;
  }

  const variantes = await db.variante.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      nombre: true,
      codigoBarras: true,
      precioVenta: true,
      producto: { select: { nombre: true, tieneVariantes: true } },
    },
  });
  const porId = new Map(variantes.map((v) => [v.id, v]));

  const plantilla = PLANTILLAS[pedido.formato];
  const doc = await PDFDocument.create();
  doc.setTitle("Etiquetas");
  doc.setCreator("Sistema de Gestión");
  const fuentes = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const imagenes = new Map<string, PDFImage>();

  const porPagina = plantilla.columnas * plantilla.filas;
  let page: PDFPage | null = null;
  let n = 0;
  for (const item of pedido.items) {
    const v = porId.get(item.varianteId);
    if (!v || !v.codigoBarras) continue;
    let imagen = imagenes.get(v.codigoBarras);
    if (!imagen) {
      imagen = await doc.embedPng(await renderizarCode128(v.codigoBarras));
      imagenes.set(v.codigoBarras, imagen);
    }
    for (let k = 0; k < item.cantidad; k++) {
      const pos = n % porPagina;
      if (pos === 0) page = doc.addPage([plantilla.pagina.ancho * MM, plantilla.pagina.alto * MM]);
      const col = pos % plantilla.columnas;
      const fila = Math.floor(pos / plantilla.columnas);
      const x = (plantilla.margen.izquierda + col * plantilla.paso.horizontal) * MM;
      const yArriba = (plantilla.margen.arriba + fila * plantilla.paso.vertical) * MM;
      const y = plantilla.pagina.alto * MM - yArriba - plantilla.etiqueta.alto * MM;
      dibujarEtiqueta(
        page!,
        x,
        y,
        plantilla,
        {
          nombre: nombreCompleto(v.producto.nombre, v.nombre, v.producto.tieneVariantes),
          codigo: v.codigoBarras,
          precio: pedido.mostrarPrecio ? formatearPesos(v.precioVenta.toFixed(2)) : null,
        },
        imagen,
        fuentes,
      );
      n++;
    }
  }
  if (n === 0) throw new DomainError("No hay etiquetas para generar.");
  return { pdf: await doc.save(), etiquetas: n, codigosGenerados };
}
