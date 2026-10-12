import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { obtenerEnv } from "@/env";
import { logger } from "@/server/log";
import { obtenerStorage } from "@/server/storage";

/**
 * Entrega de PDFs (cotizaciones, remitos, recibos de cobro, reportes).
 *
 * Todos los PDFs se sirven desde un Route Handler GET (runtime "nodejs") que
 * los GENERA en el momento, con la sesión y el permiso del módulo, y los
 * devuelve inline. Los botones son links a esa ruta en una pestaña nueva:
 * nunca dependen de un archivo guardado antes ni de una Server Action que
 * devuelva una URL (lo que fallaba: ver `responderPdf`).
 *
 * Los documentos que no cambian seguido (cotización, remito, recibo) se
 * cachean en el storage con una clave que incluye una FIRMA del contenido
 * (estado, updatedAt, logo…): si el documento cambia, cambia la clave y se
 * regenera solo. El caché es una optimización: si el storage no se puede leer
 * o escribir, el PDF se genera y se entrega igual.
 */

/** Clave de caché: `pdf/<tipo>/<panel>/<id>-<hash de la firma>.pdf`. */
export function clavePdf(tipo: string, panelId: string, id: string, firma: unknown): string {
  const limpio = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const hash = createHash("sha256").update(JSON.stringify(firma)).digest("hex").slice(0, 16);
  return `pdf/${limpio(tipo)}/${limpio(panelId)}/${limpio(id)}-${hash}.pdf`;
}

/** Nombre de archivo seguro para Content-Disposition. */
function nombreArchivo(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "-");
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

/** Respuesta HTTP de un PDF para ver en el navegador (inline), sin caché HTTP. */
export function respuestaPdf(pdf: Uint8Array, archivo: string): Response {
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombreArchivo(archivo)}"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

/**
 * Lee el PDF del caché del storage o lo genera (y lo guarda, sin bloquear la
 * respuesta si el guardado falla). Antes, el PDF se guardaba PRIMERO en el
 * storage y recién después se devolvía un link a ese archivo: con
 * `STORAGE_PROVIDER=local` en Vercel el guardado tiraba
 * `EROFS: read-only file system, mkdir '/var/task/.storage/cotizaciones'`
 * y el botón mostraba "No se pudo generar el PDF"; y aunque se guardara (en
 * /tmp), el link podía caer en otra instancia que no tenía el archivo (404).
 */
export async function pdfCacheado(clave: string, generar: () => Promise<Uint8Array>) {
  const storage = obtenerStorage();
  try {
    const cache = await storage.leer(clave);
    if (cache && cache.datos.byteLength > 4) return cache.datos;
  } catch (error) {
    logger().warn({ err: error, clave }, "pdf: no se pudo leer el caché");
  }
  const pdf = await generar();
  try {
    await storage.guardar(clave, pdf, "application/pdf");
  } catch (error) {
    logger().warn({ err: error, clave }, "pdf: no se pudo guardar el caché (se entrega igual)");
  }
  return pdf;
}

/** `pdfCacheado` + `respuestaPdf`. */
export async function responderPdf(opciones: {
  clave: string;
  archivo: string;
  generar: () => Promise<Uint8Array>;
}): Promise<Response> {
  return respuestaPdf(await pdfCacheado(opciones.clave, opciones.generar), opciones.archivo);
}

/** PDFs que se comparten por WhatsApp con un link sin sesión. */
export type TipoPdfPublico = "cotizacion" | "remito";

/**
 * Firma de un link público a un PDF: HMAC-SHA256 con AUTH_SECRET sobre tipo,
 * panel e id (no se puede adivinar ni recorrer; no vence).
 */
export function firmaLinkPublico(tipo: TipoPdfPublico, panelId: string, id: string): string {
  return createHmac("sha256", obtenerEnv().AUTH_SECRET)
    .update(`pdf:${tipo}:${panelId}:${id}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verificarLinkPublico(
  tipo: TipoPdfPublico,
  panelId: string,
  id: string,
  firma: string,
): boolean {
  const esperada = Buffer.from(firmaLinkPublico(tipo, panelId, id));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/** `/api/publico/pdf/{tipo}/{panelId}/{id}/{firma}`: el PDF se genera en el momento. */
export function rutaPublicaPdf(tipo: TipoPdfPublico, panelId: string, id: string): string {
  return `/api/publico/pdf/${tipo}/${panelId}/${id}/${firmaLinkPublico(tipo, panelId, id)}`;
}
