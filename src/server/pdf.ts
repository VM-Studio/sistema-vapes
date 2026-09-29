import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { rgb, type PDFFont, type PDFPage } from "pdf-lib";

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

/**
 * Paleta de los PDFs (la misma del sistema de diseño, en rgb de pdf-lib):
 * blanco y negro con grises; azul y naranja de la marca solo para datos.
 */
const hex = (h: string) =>
  rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  );
export const COLOR_PDF = {
  texto: hex("#0A0A0A"),
  muted: hex("#525252"),
  subtle: hex("#8A8A8A"),
  card: hex("#F4F5F7"),
  borde: hex("#E6E8EB"),
  actual: hex("#0047B0"),
  anterior: hex("#FE7B38"),
  sube: hex("#0047B0"),
  baja: hex("#D95E1E"),
};

/** Rectángulo con esquinas redondeadas; (x, y) es la esquina inferior izquierda. */
export function rectRedondeado(
  page: PDFPage,
  x: number,
  y: number,
  ancho: number,
  alto: number,
  radio: number,
  color: ReturnType<typeof rgb>,
) {
  const r = Math.min(radio, ancho / 2, alto / 2);
  const w = ancho;
  const h = alto;
  page.drawSvgPath(
    `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`,
    { x, y: y + h, color, borderWidth: 0 },
  );
}

/**
 * Lee un archivo de `public/` (logos de marca como "/logoVape.png"). null si
 * la ruta sale de `public/` o no existe.
 */
export async function leerArchivoPublico(ruta: string): Promise<Uint8Array | null> {
  if (!ruta.startsWith("/") || ruta.startsWith("//")) return null;
  const raiz = path.join(process.cwd(), "public");
  const destino = path.resolve(raiz, `.${decodeURIComponent(ruta.split("?")[0]!)}`);
  if (!destino.startsWith(raiz + path.sep)) return null;
  try {
    return new Uint8Array(await readFile(destino));
  } catch {
    return null;
  }
}
