import "server-only";

import { PassThrough, Readable, type Writable } from "node:stream";

import { formatInTimeZone } from "date-fns-tz";
import ExcelJS from "exceljs";

import type { Celda, ColumnaReporte, DocumentoReporte, TipoCelda } from "@/lib/reportes/documento";
import { formatearFechaHora } from "@/lib/utils";

import type { MetaPdf } from "./pdf-reporte";

/**
 * Excel de un DocumentoReporte con exceljs en modo STREAMING (WorkbookWriter):
 * las filas se escriben y liberan a medida que se generan, así un reporte
 * grande no se arma entero en memoria. Una hoja por sección (+ "Resumen" con
 * los KPIs), encabezados en negrita, formatos numéricos/moneda/fecha, anchos
 * de columna, filtros automáticos y encabezado congelado.
 */

const FORMATO: Record<TipoCelda, string | undefined> = {
  moneda: '"$" #,##0.00;[Red]-"$" #,##0.00',
  entero: "#,##0",
  decimal: "#,##0.00",
  porcentaje: "0.0%",
  fecha: "dd/mm/yyyy",
  fechaHora: "dd/mm/yyyy hh:mm",
  texto: undefined,
};

const ANCHO: Record<TipoCelda, number> = {
  texto: 28,
  entero: 11,
  decimal: 12,
  moneda: 16,
  porcentaje: 10,
  fecha: 12,
  fechaHora: 17,
};

/** Excel no tiene zonas horarias: se escribe la hora local del negocio. */
function fechaLocal(iso: string, tz: string): Date {
  return new Date(`${formatInTimeZone(new Date(iso), tz, "yyyy-MM-dd'T'HH:mm:ss")}Z`);
}

function valorExcel(v: Celda | undefined, tipo: TipoCelda, tz: string): ExcelJS.CellValue {
  if (v === null || v === undefined || v === "") return null;
  if ((tipo === "fecha" || tipo === "fechaHora") && Number.isNaN(new Date(String(v)).getTime()))
    return String(v); // "Total"
  switch (tipo) {
    case "moneda":
    case "entero":
    case "decimal":
      return Number(v);
    case "porcentaje":
      return Number(v) / 100;
    case "fecha":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
        ? new Date(`${v}T00:00:00Z`)
        : fechaLocal(String(v), tz);
    case "fechaHora":
      return fechaLocal(String(v), tz);
    default:
      return String(v);
  }
}

function nombreHoja(titulo: string, usados: Set<string>): string {
  const base =
    titulo
      .replace(/[[\]:*?/\\]/g, " ")
      .slice(0, 28)
      .trim() || "Hoja";
  let nombre = base;
  for (let i = 2; usados.has(nombre.toLowerCase()); i++) nombre = `${base.slice(0, 26)} ${i}`;
  usados.add(nombre.toLowerCase());
  return nombre;
}

function cabecera(ws: ExcelJS.Worksheet, doc: DocumentoReporte, meta: MetaPdf, titulo: string) {
  ws.addRow([meta.negocio]).getCell(1).font = { bold: true, size: 12, color: { argb: "FF555566" } };
  ws.addRow([titulo]).getCell(1).font = { bold: true, size: 14 };
  ws.addRow([doc.filtros.map((f) => `${f.etiqueta}: ${f.valor}`).join("  ·  ")]).getCell(1).font = {
    size: 9,
    color: { argb: "FF555566" },
  };
  ws
    .addRow([`Generado ${formatearFechaHora(meta.generadoEn)} por ${meta.generadoPor}`])
    .getCell(1).font = {
    size: 9,
    color: { argb: "FF555566" },
  };
  ws.addRow([]);
}

const FILAS_CABECERA = 5;

export async function escribirExcelReporte(
  doc: DocumentoReporte,
  meta: MetaPdf & { tz: string },
  destino: Writable,
): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: destino, useStyles: true });
  wb.creator = meta.negocio;
  wb.created = meta.generadoEn;
  const usados = new Set<string>();

  if (doc.kpis?.length) {
    const ws = wb.addWorksheet(nombreHoja("Resumen", usados));
    ws.columns = [{ width: 30 }, { width: 20 }, { width: 18 }];
    cabecera(ws, doc, meta, doc.titulo);
    const h = ws.addRow(["Indicador", "Valor", "Vs. período anterior"]);
    h.font = { bold: true };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F3" } };
    h.commit();
    for (const k of doc.kpis) {
      const r = ws.addRow([
        k.etiqueta,
        valorExcel(k.valor, k.tipo, meta.tz),
        k.delta === undefined || k.delta === null ? null : k.delta / 100,
      ]);
      r.getCell(2).numFmt = FORMATO[k.tipo] ?? "General";
      r.getCell(3).numFmt = "+0.0%;[Red]-0.0%";
      r.commit();
    }
    ws.commit();
  }

  for (const s of doc.secciones) {
    const ws = wb.addWorksheet(nombreHoja(s.titulo, usados), {
      views: [{ state: "frozen", ySplit: FILAS_CABECERA + 1 }],
    });
    ws.columns = s.columnas.map((c: ColumnaReporte) => ({
      key: c.clave,
      width: c.ancho ? Math.max(8, Math.round(c.ancho * 9)) : ANCHO[c.tipo],
      style: FORMATO[c.tipo] ? { numFmt: FORMATO[c.tipo] } : {},
    }));
    cabecera(ws, doc, meta, s.titulo);
    const encabezado = ws.addRow(s.columnas.map((c) => c.titulo));
    encabezado.font = { bold: true };
    encabezado.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F3" } };
    encabezado.alignment = { vertical: "middle", wrapText: true };
    encabezado.commit();
    ws.autoFilter = {
      from: { row: FILAS_CABECERA + 1, column: 1 },
      to: { row: FILAS_CABECERA + 1 + Math.max(1, s.filas.length), column: s.columnas.length },
    };
    for (const f of s.filas) {
      const r = ws.addRow(s.columnas.map((c) => valorExcel(f[c.clave], c.tipo, meta.tz)));
      if (f._estilo) r.font = { bold: true };
      if (f._estilo === "grupo")
        r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E6EC" } };
      if (f._alerta === "danger") r.font = { ...(r.font ?? {}), color: { argb: "FFC81E1E" } };
      r.commit();
    }
    if (s.totales) {
      const r = ws.addRow(s.columnas.map((c) => valorExcel(s.totales![c.clave], c.tipo, meta.tz)));
      r.font = { bold: true };
      r.border = { top: { style: "thin" } };
      r.commit();
    }
    ws.commit();
  }
  await wb.commit();
}

/** Stream web (para la Route Handler): el archivo sale mientras se genera. */
export function streamExcelReporte(
  doc: DocumentoReporte,
  meta: MetaPdf & { tz: string },
): ReadableStream<Uint8Array> {
  const paso = new PassThrough();
  escribirExcelReporte(doc, meta, paso).catch((e: unknown) => paso.destroy(e as Error));
  return Readable.toWeb(paso) as ReadableStream<Uint8Array>;
}

/** Todo en memoria (tests / adjuntos chicos). */
export async function generarExcelReporte(
  doc: DocumentoReporte,
  meta: MetaPdf & { tz: string },
): Promise<Buffer> {
  const paso = new PassThrough();
  const partes: Buffer[] = [];
  paso.on("data", (b: Buffer) => partes.push(b));
  const fin = new Promise<void>((ok, mal) => {
    paso.on("end", ok);
    paso.on("error", mal);
  });
  await escribirExcelReporte(doc, meta, paso);
  await fin;
  return Buffer.concat(partes);
}
