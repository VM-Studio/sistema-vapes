import "server-only";

import { ValidationError } from "@/server/errors";

/**
 * Archivos subidos por usuarios (fotos de tickets, logo/ícono del negocio).
 * - El tipo se decide por los MAGIC BYTES, nunca por la extensión ni por el
 *   Content-Type que manda el navegador (un .exe renombrado a .jpg se rechaza).
 * - Límite de 5 MB.
 * - La imagen se RE-CODIFICA con sharp: se descartan metadatos (EXIF con GPS,
 *   modelo del celular) y cualquier payload pegado al archivo; se orienta
 *   según EXIF y se achica a 2000 px como máximo.
 * - El nombre del archivo lo pone el servidor (clave aleatoria).
 */
export const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;

export type TipoDetectado = "image/png" | "image/jpeg" | "image/webp" | "application/pdf" | null;

export function detectarTipo(b: Uint8Array): TipoDetectado {
  const es = (offset: number, bytes: number[]) => bytes.every((x, i) => b[offset + i] === x);
  if (b.length >= 8 && es(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (b.length >= 3 && es(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (b.length >= 12 && es(0, [0x52, 0x49, 0x46, 0x46]) && es(8, [0x57, 0x45, 0x42, 0x50]))
    return "image/webp";
  if (b.length >= 5 && es(0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

export interface ImagenProcesada {
  datos: Uint8Array;
  tipo: "image/jpeg" | "image/png";
  ancho: number;
  alto: number;
}

/**
 * Valida y limpia una imagen. `formato: "png"` conserva la transparencia
 * (logos/íconos); por defecto sale JPEG (fotos).
 */
export async function procesarImagenSubida(
  datos: Uint8Array,
  opciones: { campo?: string; maxLado?: number; formato?: "jpeg" | "png" } = {},
): Promise<ImagenProcesada> {
  const campo = opciones.campo ?? "archivo";
  if (datos.byteLength === 0)
    throw new ValidationError("El archivo está vacío", { [campo]: ["Archivo vacío"] });
  if (datos.byteLength > MAX_IMAGEN_BYTES)
    throw new ValidationError("La imagen supera los 5 MB", { [campo]: ["Máximo 5 MB"] });
  const tipo = detectarTipo(datos);
  if (tipo !== "image/png" && tipo !== "image/jpeg" && tipo !== "image/webp") {
    throw new ValidationError("El archivo no es una imagen JPG, PNG o WebP válida", {
      [campo]: ["Formato no admitido (se revisa el contenido, no la extensión)"],
    });
  }
  try {
    const lado = opciones.maxLado ?? 2000;
    // Carga diferida: sharp (binario nativo) solo se levanta al procesar una imagen.
    const { default: sharp } = await import("sharp");
    let img = sharp(datos, { limitInputPixels: 50_000_000, failOn: "error" })
      .rotate() // aplica la orientación EXIF antes de descartarla
      .resize({ width: lado, height: lado, fit: "inside", withoutEnlargement: true });
    img =
      opciones.formato === "png"
        ? img.png({ compressionLevel: 9 })
        : img.jpeg({ quality: 82, mozjpeg: true });
    const { data, info } = await img.toBuffer({ resolveWithObject: true }); // sin withMetadata(): se descarta todo
    return {
      datos: new Uint8Array(data),
      tipo: opciones.formato === "png" ? "image/png" : "image/jpeg",
      ancho: info.width,
      alto: info.height,
    };
  } catch {
    throw new ValidationError("La imagen está dañada o no se puede leer", {
      [campo]: ["Imagen inválida"],
    });
  }
}
