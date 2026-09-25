import "server-only";

import type { PDFFont } from "pdf-lib";

/** Puntos por milímetro (PDF = 72 pt por pulgada). */
export const MM = 72 / 25.4;

/**
 * pdf-lib con las fuentes estándar solo dibuja WinAnsi: los espacios finos que
 * mete Intl ("$ 1.000") se pasan a espacio común y lo que no se pueda, a "?".
 */
export function aWinAnsi(texto: string, fuente: PDFFont): string {
  return [...texto.replace(/[   ]/g, " ")]
    .map((ch) => {
      try {
        fuente.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    })
    .join("");
}

/** Recorta con "…" para que entre en `anchoMax` puntos. */
export function recortar(
  texto: string,
  fuente: PDFFont,
  tamanio: number,
  anchoMax: number,
): string {
  if (fuente.widthOfTextAtSize(texto, tamanio) <= anchoMax) return texto;
  let t = texto;
  while (t.length > 1 && fuente.widthOfTextAtSize(`${t}…`, tamanio) > anchoMax) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Parte un texto en líneas que entren en `anchoMax` (por palabras). */
export function envolver(
  texto: string,
  fuente: PDFFont,
  tamanio: number,
  anchoMax: number,
): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (fuente.widthOfTextAtSize(candidata, tamanio) <= anchoMax) actual = candidata;
    else {
      if (actual) lineas.push(actual);
      actual = recortar(palabra, fuente, tamanio, anchoMax);
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [""];
}
