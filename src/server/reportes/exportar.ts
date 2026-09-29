import "server-only";

import ExcelJS from "exceljs";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { formatearNumero, formatearPesos } from "@/lib/format";
import { formatearFechaHora } from "@/lib/utils";
import { aWinAnsi, recortar } from "@/server/pdf";
import { obtenerStorage } from "@/server/storage";

/**
 * Exportación de reportes a PDF (A4, vertical o apaisado) y Excel, con la
 * misma cabecera: logo y nombre del panel, título, período y filtros
 * aplicados. Un reporte es una o más tablas.
 */

export type TipoColumna = "texto" | "numero" | "moneda" | "pct";

export interface ColumnaExport {
  titulo: string;
  tipo?: TipoColumna;
  /** Peso relativo del ancho en el PDF (default 1). */
  ancho?: number;
}

export type Celda = string | number | null;

export interface TablaExport {
  titulo?: string;
  columnas: ColumnaExport[];
  filas: Celda[][];
  totales?: Celda[];
}

export interface Exportacion {
  titulo: string;
  /** Nombre base del archivo (sin extensión). */
  archivo: string;
  periodo: string | null;
  filtros: string[];
  apaisado?: boolean;
  tablas: TablaExport[];
}

export interface CabeceraPanel {
  negocio: string;
  panel: string;
  logoUrl: string | null;
}

const PREFIJO_ARCHIVOS = "/api/publico/archivos/";

/** Logo del panel (PNG/JPG, del storage propio o una URL). null si no hay o no se puede leer. */
export async function cargarLogo(
  doc: PDFDocument,
  logoUrl: string | null,
): Promise<PDFImage | null> {
  if (!logoUrl) return null;
  try {
    let datos: Uint8Array | null = null;
    if (logoUrl.startsWith(PREFIJO_ARCHIVOS)) {
      datos = (await obtenerStorage().leer(logoUrl.slice(PREFIJO_ARCHIVOS.length)))?.datos ?? null;
    } else if (/^https?:\/\//.test(logoUrl)) {
      const r = await fetch(logoUrl, { signal: AbortSignal.timeout(3000) });
      if (r.ok) datos = new Uint8Array(await r.arrayBuffer());
    }
    if (!datos || datos.length < 4) return null;
    if (datos[0] === 0x89 && datos[1] === 0x50) return await doc.embedPng(datos);
    if (datos[0] === 0xff && datos[1] === 0xd8) return await doc.embedJpg(datos);
    return null;
  } catch {
    return null;
  }
}

function celdaTexto(v: Celda, tipo: TipoColumna = "texto"): string {
  if (v === null || v === "") return "—";
  if (tipo === "moneda") return formatearPesos(v);
  if (tipo === "numero") return typeof v === "number" ? formatearNumero(v) : v;
  if (tipo === "pct") return typeof v === "number" ? `${v.toLocaleString("es-AR")} %` : v;
  return String(v);
}

// =============================================================================
// PDF
// =============================================================================

export const A4 = { ancho: 595.28, alto: 841.89 };
export const GRIS = rgb(0.42, 0.42, 0.45);
export const NEGRO = rgb(0.07, 0.07, 0.09);
const LINEA = rgb(0.86, 0.86, 0.88);
const FONDO_CAB = rgb(0.94, 0.94, 0.95);

export interface Lienzo {
  doc: PDFDocument;
  page: PDFPage;
  normal: PDFFont;
  negrita: PDFFont;
  ancho: number;
  alto: number;
  margen: number;
  y: number;
  texto: (
    t: string,
    x: number,
    y: number,
    o?: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      derecha?: boolean;
      max?: number;
    },
  ) => void;
}

/** Documento + primera página con la cabecera del reporte. */
export async function nuevoLienzo(
  cab: CabeceraPanel,
  titulo: string,
  lineas: string[],
  apaisado = false,
): Promise<Lienzo> {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo);
  doc.setCreator(cab.negocio);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const [ancho, alto] = apaisado ? [A4.alto, A4.ancho] : [A4.ancho, A4.alto];
  const l: Lienzo = {
    doc,
    page: doc.addPage([ancho, alto]),
    normal,
    negrita,
    ancho,
    alto,
    margen: 36,
    y: alto - 36,
    texto: (t, x, y, o = {}) => {
      const font = o.font ?? normal;
      const size = o.size ?? 8.5;
      let s = aWinAnsi(t.replace(/−/g, "-"), font);
      if (o.max) s = recortar(s, font, size, o.max);
      const dx = o.derecha ? font.widthOfTextAtSize(s, size) : 0;
      l.page.drawText(s, { x: x - dx, y, size, font, color: o.color ?? NEGRO });
    },
  };
  const logo = await cargarLogo(doc, cab.logoUrl);
  let x = l.margen;
  if (logo) {
    const k = Math.min(40 / logo.width, 40 / logo.height);
    l.page.drawImage(logo, {
      x,
      y: l.y - logo.height * k,
      width: logo.width * k,
      height: logo.height * k,
    });
    x += logo.width * k + 10;
  }
  l.texto(cab.negocio, x, l.y - 13, { size: 13, font: negrita });
  l.texto(cab.panel, x, l.y - 27, { size: 9, color: GRIS });
  l.texto(`Generado ${formatearFechaHora(new Date())}`, ancho - l.margen, l.y - 13, {
    derecha: true,
    color: GRIS,
    size: 8,
  });
  l.y -= 52;
  l.texto(titulo, l.margen, l.y, { size: 15, font: negrita });
  l.y -= 14;
  for (const linea of lineas) {
    l.texto(linea, l.margen, l.y, { size: 8.5, color: GRIS, max: ancho - 2 * l.margen });
    l.y -= 11;
  }
  l.y -= 4;
  l.page.drawLine({
    start: { x: l.margen, y: l.y },
    end: { x: ancho - l.margen, y: l.y },
    thickness: 0.6,
    color: LINEA,
  });
  l.y -= 16;
  return l;
}

function nuevaPagina(l: Lienzo, titulo: string) {
  l.page = l.doc.addPage([l.ancho, l.alto]);
  l.y = l.alto - l.margen;
  l.texto(`${titulo} (continuación)`, l.margen, l.y, { color: GRIS });
  l.y -= 18;
}

function numerarPaginas(l: Lienzo) {
  const paginas = l.doc.getPages();
  paginas.forEach((p, i) => {
    const t = `Página ${i + 1} de ${paginas.length}`;
    p.drawText(t, {
      x: p.getWidth() - l.margen - l.normal.widthOfTextAtSize(t, 7.5),
      y: 18,
      size: 7.5,
      font: l.normal,
      color: GRIS,
    });
  });
}

function dibujarTabla(l: Lienzo, t: TablaExport, tituloDoc: string) {
  const util = l.ancho - 2 * l.margen;
  const pesos = t.columnas.map((c) => c.ancho ?? 1);
  const suma = pesos.reduce((a, b) => a + b, 0);
  const anchos = pesos.map((p) => (p / suma) * util);
  const xs = anchos.reduce<number[]>(
    (acc, _w, i) => [...acc, i === 0 ? l.margen : acc[i - 1]! + anchos[i - 1]!],
    [],
  );
  const derecha = (c: ColumnaExport) =>
    c.tipo === "numero" || c.tipo === "moneda" || c.tipo === "pct";
  const fila = (valores: Celda[], negrita: boolean) => {
    t.columnas.forEach((c, i) => {
      const s = celdaTexto(valores[i] ?? null, c.tipo);
      const w = anchos[i]! - 6;
      l.texto(s, derecha(c) ? xs[i]! + anchos[i]! - 3 : xs[i]! + 3, l.y, {
        derecha: derecha(c),
        font: negrita ? l.negrita : l.normal,
        max: w,
      });
    });
  };
  const encabezado = () => {
    l.page.drawRectangle({ x: l.margen, y: l.y - 4, width: util, height: 15, color: FONDO_CAB });
    fila(
      t.columnas.map((c) => c.titulo),
      true,
    );
    l.y -= 16;
  };
  if (l.y < l.margen + 60) nuevaPagina(l, tituloDoc);
  if (t.titulo) {
    l.texto(t.titulo, l.margen, l.y, { size: 10.5, font: l.negrita });
    l.y -= 15;
  }
  encabezado();
  if (t.filas.length === 0) {
    l.texto("Sin datos para los filtros elegidos.", l.margen + 3, l.y, { color: GRIS });
    l.y -= 14;
  }
  for (const valores of t.filas) {
    if (l.y < l.margen + 20) {
      nuevaPagina(l, tituloDoc);
      encabezado();
    }
    fila(valores, false);
    l.y -= 5;
    l.page.drawLine({
      start: { x: l.margen, y: l.y },
      end: { x: l.ancho - l.margen, y: l.y },
      thickness: 0.3,
      color: LINEA,
    });
    l.y -= 9;
  }
  if (t.totales) {
    if (l.y < l.margen + 20) nuevaPagina(l, tituloDoc);
    fila(t.totales, true);
    l.y -= 14;
  }
  l.y -= 12;
}

export async function exportarPDF(cab: CabeceraPanel, e: Exportacion): Promise<Uint8Array> {
  const lineas = [
    ...(e.periodo ? [`Período: ${e.periodo}`] : []),
    ...(e.filtros.length ? [`Filtros: ${e.filtros.join(" · ")}`] : []),
  ];
  const l = await nuevoLienzo(cab, e.titulo, lineas, e.apaisado);
  for (const t of e.tablas) dibujarTabla(l, t, e.titulo);
  numerarPaginas(l);
  return l.doc.save();
}

export async function cerrarLienzo(l: Lienzo): Promise<Uint8Array> {
  numerarPaginas(l);
  return l.doc.save();
}

// =============================================================================
// Excel
// =============================================================================

const FORMATO: Record<TipoColumna, string | undefined> = {
  texto: undefined,
  numero: "#,##0",
  moneda: '"$" #,##0.00;[Red]-"$" #,##0.00',
  pct: '0.0" %"',
};

function valorExcel(v: Celda, tipo: TipoColumna = "texto"): string | number | null {
  if (v === null || v === "") return null;
  if (tipo === "moneda" || tipo === "numero" || tipo === "pct") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

export async function exportarExcel(cab: CabeceraPanel, e: Exportacion): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.created = new Date();
  libro.creator = cab.negocio;
  const usados = new Set<string>();
  e.tablas.forEach((t, n) => {
    let nombre =
      (t.titulo ?? e.titulo).replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || `Hoja ${n + 1}`;
    while (usados.has(nombre)) nombre = `${nombre.slice(0, 25)} ${n + 1}`;
    usados.add(nombre);
    const hoja = libro.addWorksheet(nombre);
    hoja.addRow([`${cab.negocio} — ${cab.panel}`]).font = { bold: true, size: 12 };
    hoja.addRow([t.titulo ? `${e.titulo}: ${t.titulo}` : e.titulo]).font = { bold: true, size: 14 };
    if (e.periodo) hoja.addRow([`Período: ${e.periodo}`]);
    if (e.filtros.length) hoja.addRow([`Filtros: ${e.filtros.join(" · ")}`]);
    hoja.addRow([`Generado: ${formatearFechaHora(new Date())}`]);
    hoja.addRow([]);
    const filaCab = hoja.addRow(t.columnas.map((c) => c.titulo));
    filaCab.font = { bold: true };
    filaCab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFF1" } };
    const inicio = filaCab.number;
    for (const f of t.filas)
      hoja.addRow(t.columnas.map((c, i) => valorExcel(f[i] ?? null, c.tipo)));
    if (t.totales) {
      hoja.addRow(t.columnas.map((c, i) => valorExcel(t.totales![i] ?? null, c.tipo))).font = {
        bold: true,
      };
    }
    hoja.views = [{ state: "frozen", ySplit: inicio }];
    hoja.autoFilter = {
      from: { row: inicio, column: 1 },
      to: { row: inicio, column: Math.max(1, t.columnas.length) },
    };
    t.columnas.forEach((c, i) => {
      const col = hoja.getColumn(i + 1);
      const fmt = FORMATO[c.tipo ?? "texto"];
      if (fmt) col.numFmt = fmt;
      const largo = Math.max(
        c.titulo.length,
        ...t.filas.slice(0, 300).map((f) => String(f[i] ?? "").length),
      );
      col.width = Math.min(Math.max(largo + 2, 10), 48);
    });
  });
  return Buffer.from(await libro.xlsx.writeBuffer());
}
