import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Almacenamiento de archivos (PDF de comprobantes y cierres de caja, fotos de tickets de gastos).
 *
 * `StorageProvider` es la interfaz: en producción (Prompt 7) se reemplaza por
 * S3/R2 implementando lo mismo. La implementación local guarda en `.storage/`
 * (fuera de git) y lo sirve `GET /api/publico/archivos/...`.
 *
 * Por qué no `/public/comprobantes/`: `next start` solo sirve lo que había en
 * /public al momento del build; un PDF generado después daría 404.
 *
 * Las claves llevan 24 bytes aleatorios: la URL es pública (se manda por
 * WhatsApp) pero no se puede adivinar ni recorrer (los números de comprobante sí).
 */
export interface StorageProvider {
  /** Guarda y devuelve la URL (relativa a la app, o absoluta si es un bucket). */
  guardar(clave: string, datos: Uint8Array, tipo: string): Promise<string>;
  /** null si no existe. */
  leer(clave: string): Promise<{ datos: Uint8Array; tipo: string } | null>;
}

const CLAVE_VALIDA = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.(pdf|png|jpg|webp|xlsx)$/;
const TIPOS: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type ExtensionArchivo = "pdf" | "png" | "jpg" | "webp" | "xlsx";

/** Extensión según el MIME de una imagen subida (null = no admitida). */
export function extensionDeImagen(tipo: string): "png" | "jpg" | "webp" | null {
  if (tipo === "image/png") return "png";
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/webp") return "webp";
  return null;
}

export function esClaveValida(clave: string): boolean {
  return CLAVE_VALIDA.test(clave) && !clave.includes("..");
}

class StorageLocal implements StorageProvider {
  constructor(private readonly raiz: string) {}

  private ruta(clave: string): string {
    if (!esClaveValida(clave)) throw new Error(`Clave de almacenamiento inválida: ${clave}`);
    return path.join(this.raiz, clave);
  }

  async guardar(clave: string, datos: Uint8Array): Promise<string> {
    const ruta = this.ruta(clave);
    await mkdir(path.dirname(ruta), { recursive: true });
    await writeFile(ruta, datos);
    return `/api/publico/archivos/${clave}`;
  }

  async leer(clave: string) {
    try {
      const datos = await readFile(this.ruta(clave));
      return {
        datos: new Uint8Array(datos),
        tipo: TIPOS[clave.split(".").pop() ?? ""] ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }
}

export const storage: StorageProvider = new StorageLocal(
  path.resolve(process.env.STORAGE_DIR ?? ".storage"),
);

/** Clave nueva e inadivinable: `carpeta/<prefijo>-<48 hex>.<ext>`. */
export function claveAleatoria(
  carpeta: string,
  prefijo: string,
  extension: ExtensionArchivo,
): string {
  const limpio = prefijo.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${carpeta}/${limpio}-${randomBytes(24).toString("hex")}.${extension}`;
}

/** Clave a partir de la URL que devolvió `guardar` (proveedor local). */
export function claveDeUrl(url: string): string | null {
  const prefijo = "/api/publico/archivos/";
  return url.startsWith(prefijo) ? url.slice(prefijo.length) : null;
}
