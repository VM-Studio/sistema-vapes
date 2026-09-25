import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import {
  esNumerica,
  formatearCelda,
  type ColumnaReporte,
  type DocumentoReporte,
  type FilaReporte,
  type GraficoReporte,
  type SeccionReporte,
} from "@/lib/reportes/documento";
import { formatearFechaHora } from "@/lib/utils";
import { aWinAnsi, envolver, MM, recortar } from "@/server/pdf";

/**
 * PDF de un DocumentoReporte con pdf-lib (misma librería que los
 * comprobantes). A4 vertical o apaisado; cabecera en cada página (negocio,
 * título, período y filtros, fecha de generación y usuario), KPIs, gráfico
 * de barras simple, tablas con el encabezado repetido al cortar página y
 * "Página n de N" al pie.
 */

export interface MetaPdf {
  negocio: string;
  generadoPor: string;
  generadoEn: Date;
}

const NEGRO = rgb(0.07, 0.07, 0.09);
const GRIS = rgb(0.36, 0.36, 0.42);
const GRIS_CLARO = rgb(0.94, 0.94, 0.96);
const GRIS_MEDIO = rgb(0.85, 0.85, 0.89);
const ROJO = rgb(0.78, 0.12, 0.12);
const VERDE = rgb(0.08, 0.5, 0.24);
const AZUL = rgb(0.165, 0.47, 0.84); // serie 1 de la paleta de gráficos
const NARANJA = rgb(0.92, 0.41, 0.2); // serie 2

interface Ctx {
  doc: PDFDocument;
  normal: PDFFont;
  negrita: PDFFont;
  ancho: number;
  alto: number;
  margen: number;
  page: PDFPage;
  y: number;
  documento: DocumentoReporte;
  meta: MetaPdf;
}

function texto(
  c: Ctx,
  t: string,
  x: number,
  y: number,
  tam: number,
  opts: {
    negrita?: boolean;
    color?: ReturnType<typeof rgb>;
    anchoMax?: number;
    derecha?: boolean;
  } = {},
) {
  const fuente = opts.negrita ? c.negrita : c.normal;
  let s = aWinAnsi(t, fuente);
  if (opts.anchoMax) s = recortar(s, fuente, tam, opts.anchoMax);
  const w = fuente.widthOfTextAtSize(s, tam);
  c.page.drawText(s, {
    x: opts.derecha ? x - w : x,
    y,
    size: tam,
    font: fuente,
    color: opts.color ?? NEGRO,
  });
}

function nuevaPagina(c: Ctx) {
  c.page = c.doc.addPage([c.ancho, c.alto]);
  const util = c.ancho - 2 * c.margen;
  let y = c.alto - c.margen;
  texto(c, c.meta.negocio, c.margen, y - 10, 10, {
    negrita: true,
    color: GRIS,
    anchoMax: util / 2,
  });
  texto(
    c,
    `Generado ${formatearFechaHora(c.meta.generadoEn)} por ${c.meta.generadoPor}`,
    c.ancho - c.margen,
    y - 10,
    7.5,
    {
      color: GRIS,
      derecha: true,
    },
  );
  y -= 28;
  texto(c, c.documento.titulo, c.margen, y, 15, { negrita: true, anchoMax: util });
  y -= 14;
  const filtros = c.documento.filtros.map((f) => `${f.etiqueta}: ${f.valor}`).join("   ·   ");
  for (const linea of envolver(aWinAnsi(filtros, c.normal), c.normal, 8, util)) {
    texto(c, linea, c.margen, y, 8, { color: GRIS });
    y -= 11;
  }
  c.page.drawLine({
    start: { x: c.margen, y: y + 2 },
    end: { x: c.ancho - c.margen, y: y + 2 },
    thickness: 0.8,
    color: GRIS_MEDIO,
  });
  c.y = y - 10;
}

function asegurar(c: Ctx, alto: number): boolean {
  if (c.y - alto < c.margen + 16) {
    nuevaPagina(c);
    return true;
  }
  return false;
}

function dibujarKpis(c: Ctx) {
  const kpis = c.documento.kpis ?? [];
  if (!kpis.length) return;
  const util = c.ancho - 2 * c.margen;
  const porFila = Math.min(kpis.length, c.documento.orientacion === "apaisado" ? 6 : 4);
  const gap = 6;
  const w = (util - gap * (porFila - 1)) / porFila;
  const h = 44;
  for (let i = 0; i < kpis.length; i += porFila) {
    asegurar(c, h + gap);
    kpis.slice(i, i + porFila).forEach((k, j) => {
      const x = c.margen + j * (w + gap);
      const y = c.y - h;
      c.page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: GRIS_CLARO,
        borderColor: GRIS_MEDIO,
        borderWidth: 0.5,
      });
      texto(c, k.etiqueta.toUpperCase(), x + 7, y + h - 12, 6.5, { color: GRIS, anchoMax: w - 14 });
      texto(c, formatearCelda(k.valor, k.tipo), x + 7, y + 13, 12, {
        negrita: true,
        anchoMax: w - 14,
      });
      if (k.delta !== undefined && k.delta !== null) {
        const bueno = k.deltaInvertido ? k.delta <= 0 : k.delta >= 0;
        texto(
          c,
          `${k.delta > 0 ? "+" : ""}${k.delta.toFixed(1).replace(".", ",")} %`,
          x + w - 7,
          y + 4,
          7,
          {
            color: bueno ? VERDE : ROJO,
            derecha: true,
          },
        );
      }
    });
    c.y -= h + gap;
  }
  c.y -= 6;
}

function dibujarGrafico(c: Ctx, g: GraficoReporte) {
  const alto = 150;
  asegurar(c, alto + 30);
  const util = c.ancho - 2 * c.margen;
  texto(c, g.titulo, c.margen, c.y - 10, 10, { negrita: true });
  c.y -= 18;
  const base = c.y - alto + 14;
  const series = g.series.slice(0, 2);
  const valores = g.datos.flatMap((d) => series.map((s) => Number(d[s.clave] ?? 0)));
  const max = Math.max(1, ...valores);
  const min = Math.min(0, ...valores);
  const escala = (alto - 24) / (max - min);
  const cero = base + -min * escala;
  // Grilla recesiva: 0, 50 %, 100 %.
  for (const f of [0, 0.5, 1]) {
    const v = min + (max - min) * f;
    const y = cero + v * escala;
    c.page.drawLine({
      start: { x: c.margen + 44, y },
      end: { x: c.margen + util, y },
      thickness: 0.4,
      color: GRIS_MEDIO,
    });
    texto(
      c,
      formatearCelda(Math.round(v), g.formato === "moneda" ? "moneda" : "entero"),
      c.margen + 40,
      y - 2.5,
      6,
      {
        color: GRIS,
        derecha: true,
      },
    );
  }
  const n = g.datos.length || 1;
  const paso = (util - 48) / n;
  const anchoBarra = Math.max(1.5, Math.min(18, (paso - 2) / series.length));
  const cada = Math.ceil(n / 16); // etiquetas del eje x sin pisarse
  g.datos.forEach((d, i) => {
    series.forEach((s, k) => {
      const v = Number(d[s.clave] ?? 0);
      const x = c.margen + 48 + i * paso + k * anchoBarra + (paso - anchoBarra * series.length) / 2;
      const h = Math.abs(v) * escala;
      c.page.drawRectangle({
        x,
        y: v >= 0 ? cero : cero - h,
        width: anchoBarra - 0.5,
        height: Math.max(h, 0.3),
        color: k === 0 ? AZUL : NARANJA,
      });
    });
    if (i % cada === 0) {
      texto(c, String(d[g.x] ?? ""), c.margen + 48 + i * paso + paso / 2 - 10, base - 10, 6, {
        color: GRIS,
        anchoMax: paso * cada,
      });
    }
  });
  // Leyenda (identidad nunca solo por color: nombre al lado del color).
  let lx = c.margen + util;
  for (const [k, s] of [...series.entries()].reverse()) {
    const w = c.normal.widthOfTextAtSize(aWinAnsi(s.nombre, c.normal), 7);
    lx -= w;
    texto(c, s.nombre, lx, c.y + 6, 7, { color: GRIS });
    lx -= 10;
    c.page.drawRectangle({
      x: lx,
      y: c.y + 6,
      width: 7,
      height: 7,
      color: k === 0 ? AZUL : NARANJA,
    });
    lx -= 10;
  }
  c.y = base - 22;
}

function anchosColumnas(cols: ColumnaReporte[], util: number): number[] {
  const pesos = cols.map(
    (col) => col.ancho ?? (col.tipo === "texto" ? 3 : col.tipo === "fechaHora" ? 1.8 : 1.4),
  );
  const total = pesos.reduce((a, b) => a + b, 0);
  return pesos.map((p) => (p / total) * util);
}

function dibujarSeccion(c: Ctx, s: SeccionReporte) {
  const util = c.ancho - 2 * c.margen;
  const tam = s.columnas.length > 11 ? 6.5 : s.columnas.length > 8 ? 7 : 8;
  const altoFila = tam + 6;
  const anchos = anchosColumnas(s.columnas, util);
  asegurar(c, 40 + altoFila * 2);
  texto(c, s.titulo, c.margen, c.y - 10, 10.5, { negrita: true });
  c.y -= 16;
  if (s.descripcion) {
    for (const l of envolver(aWinAnsi(s.descripcion, c.normal), c.normal, 7.5, util)) {
      texto(c, l, c.margen, c.y - 7, 7.5, { color: GRIS });
      c.y -= 10;
    }
    c.y -= 2;
  }

  const encabezado = () => {
    c.page.drawRectangle({
      x: c.margen,
      y: c.y - altoFila,
      width: util,
      height: altoFila,
      color: GRIS_CLARO,
    });
    let x = c.margen;
    s.columnas.forEach((col, i) => {
      const w = anchos[i]!;
      const der = esNumerica(col.tipo);
      texto(c, col.titulo, der ? x + w - 3 : x + 3, c.y - altoFila + 4, tam, {
        negrita: true,
        anchoMax: w - 6,
        derecha: der,
        color: GRIS,
      });
      x += w;
    });
    c.y -= altoFila;
  };

  const fila = (f: FilaReporte, esTotal = false, zebra = false) => {
    if (asegurar(c, altoFila)) {
      texto(c, `${s.titulo} (continuación)`, c.margen, c.y - 9, 8, { color: GRIS });
      c.y -= 13;
      encabezado();
    }
    const negrita = esTotal || f._estilo === "subtotal" || f._estilo === "grupo";
    if (f._estilo === "grupo" || zebra) {
      c.page.drawRectangle({
        x: c.margen,
        y: c.y - altoFila,
        width: util,
        height: altoFila,
        color: f._estilo === "grupo" ? GRIS_MEDIO : rgb(0.975, 0.975, 0.985),
      });
    }
    if (esTotal) {
      c.page.drawLine({
        start: { x: c.margen, y: c.y },
        end: { x: c.margen + util, y: c.y },
        thickness: 0.8,
        color: NEGRO,
      });
    }
    let x = c.margen;
    s.columnas.forEach((col, i) => {
      const w = anchos[i]!;
      const der = esNumerica(col.tipo);
      const v = f[col.clave];
      const t =
        v === undefined && (esTotal || f._estilo) ? "" : formatearCelda(v ?? null, col.tipo);
      const negativo = der && typeof v !== "undefined" && v !== null && Number(v) < 0;
      texto(c, t, der ? x + w - 3 : x + 3, c.y - altoFila + 4, tam, {
        negrita,
        anchoMax: w - 6,
        derecha: der,
        color: f._alerta === "danger" || (negativo && col.tipo === "moneda") ? ROJO : NEGRO,
      });
      x += w;
    });
    c.y -= altoFila;
  };

  encabezado();
  if (s.filas.length === 0) {
    texto(c, s.vacio ?? "Sin datos para este período.", c.margen + 3, c.y - altoFila + 4, tam, {
      color: GRIS,
    });
    c.y -= altoFila;
  }
  s.filas.forEach((f, i) => fila(f, false, i % 2 === 1 && !f._estilo));
  if (s.totales) fila(s.totales, true);
  c.y -= 14;
}

export async function generarPdfReporte(
  documento: DocumentoReporte,
  meta: MetaPdf,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(documento.titulo);
  doc.setCreator(meta.negocio);
  doc.setProducer("Sistema de gestión");
  const [ancho, alto] =
    documento.orientacion === "apaisado" ? [297 * MM, 210 * MM] : [210 * MM, 297 * MM];
  const c: Ctx = {
    doc,
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
    ancho,
    alto,
    margen: 12 * MM,
    page: undefined as unknown as PDFPage,
    y: 0,
    documento,
    meta,
  };
  nuevaPagina(c);
  dibujarKpis(c);
  for (const g of documento.graficos ?? []) if (g.enPdf) dibujarGrafico(c, g);
  for (const s of documento.secciones) dibujarSeccion(c, s);
  if (documento.nota) {
    const util = c.ancho - 2 * c.margen;
    for (const l of envolver(aWinAnsi(documento.nota, c.normal), c.normal, 7.5, util)) {
      asegurar(c, 10);
      texto(c, l, c.margen, c.y - 7, 7.5, { color: GRIS });
      c.y -= 10;
    }
  }
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    const t = `Página ${i + 1} de ${paginas.length}`;
    const w = c.normal.widthOfTextAtSize(t, 7);
    p.drawText(t, {
      x: ancho - c.margen - w,
      y: c.margen - 12,
      size: 7,
      font: c.normal,
      color: GRIS,
    });
    p.drawText(aWinAnsi(documento.titulo, c.normal), {
      x: c.margen,
      y: c.margen - 12,
      size: 7,
      font: c.normal,
      color: GRIS,
    });
  });
  return doc.save();
}
