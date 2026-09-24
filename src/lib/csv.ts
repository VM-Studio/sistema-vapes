/**
 * CSV sin dependencias, pensado para planillas hechas en Excel argentino:
 * - Encoding: UTF-8 (con o sin BOM) o Latin-1/Windows-1252 (Excel "CSV" viejo).
 * - Separador: ";" (Excel es-AR) o "," — se detecta en la línea de encabezados.
 * - Comillas RFC 4180: campos con separador, comillas ("") o saltos de línea.
 */

export type Separador = ";" | ",";

/** Decodifica bytes: intenta UTF-8 estricto; si hay bytes inválidos, es Latin-1. */
export function decodificarTexto(bytes: Uint8Array): {
  texto: string;
  encoding: "utf-8" | "windows-1252";
} {
  try {
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { texto: texto.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return { texto: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/** El separador que más aparece en la primera línea (fuera de comillas). */
export function detectarSeparador(texto: string): Separador {
  const primera = texto.split(/\r?\n/, 1)[0] ?? "";
  let dentro = false;
  let pc = 0;
  let coma = 0;
  for (const ch of primera) {
    if (ch === '"') dentro = !dentro;
    else if (!dentro && ch === ";") pc++;
    else if (!dentro && ch === ",") coma++;
  }
  return pc >= coma && pc > 0 ? ";" : ",";
}

/** Parsea todo el texto a filas de celdas. Ignora filas completamente vacías. */
export function parsearCSV(
  texto: string,
  separador: Separador = detectarSeparador(texto),
): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let dentro = false;

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (dentro) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else dentro = false;
      } else celda += ch;
      continue;
    }
    if (ch === '"') dentro = true;
    else if (ch === separador) {
      fila.push(celda);
      celda = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += ch;
  }
  if (celda !== "" || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c.trim() !== ""));
}

function escaparCelda(valor: string, separador: Separador): string {
  return /["\r\n]/.test(valor) || valor.includes(separador)
    ? `"${valor.replace(/"/g, '""')}"`
    : valor;
}

/**
 * Genera CSV con BOM (Excel detecta UTF-8) y ";" (separador de Excel es-AR).
 * Los montos conviene pasarlos ya con formatearDecimalAR().
 */
export function aCSV(
  filas: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
  separador: Separador = ";",
): string {
  const cuerpo = filas
    .map((f) =>
      f
        .map((c) => escaparCelda(c === null || c === undefined ? "" : String(c), separador))
        .join(separador),
    )
    .join("\r\n");
  return `﻿${cuerpo}\r\n`;
}

/** "9500.50" -> "9500,50" (lo que Excel es-AR entiende como número). */
export function formatearDecimalAR(valor: string | number): string {
  return String(valor).replace(".", ",");
}

/**
 * Interpreta un precio escrito a mano: "1.234,56", "1234,56", "1234.56",
 * "$ 9.500", "9500". Devuelve el número como string con punto decimal, o null.
 */
export function parsearPrecioAR(texto: string): string | null {
  let t = texto.replace(/[$\s]/g, "");
  if (t === "") return null;
  const ultimaComa = t.lastIndexOf(",");
  const ultimoPunto = t.lastIndexOf(".");
  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    // El que aparece último es el separador decimal; el otro, de miles.
    t = ultimaComa > ultimoPunto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (ultimaComa !== -1) {
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ""); // "9.500" = nueve mil quinientos
  }
  return /^-?\d+(\.\d+)?$/.test(t) ? t : null;
}

/** "Código de barras" -> "codigo_de_barras" (para mapear encabezados con tildes/espacios). */
export function normalizarEncabezado(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
