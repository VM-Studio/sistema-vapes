import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { obtenerEnv } from "@/env";

/**
 * Almacenamiento de archivos: PDFs de comprobantes, cierres y reportes,
 * etiquetas, fotos de tickets de gastos, íconos de la app y backups.
 *
 * `STORAGE_PROVIDER=local` (desarrollo): carpeta `.storage/`.
 * `STORAGE_PROVIDER=s3` (producción): Cloudflare R2 (o cualquier S3).
 *
 * Referencias que se guardan en la DB (`pdfUrl`, `comprobanteUrl`):
 *   - privados → `/api/publico/archivos/<clave>`. Esa ruta (sin sesión, pero
 *     con 24 bytes aleatorios en la clave) sirve el archivo (local) o
 *     redirige a una URL firmada de 5 minutos (S3). La referencia nunca vence.
 *   - públicos (logos, imágenes de producto) → URL pública del bucket.
 * Para compartir por WhatsApp: `urlCompartible()` → URL firmada de 7 días (S3).
 */
export interface StorageProvider {
  readonly nombre: "local" | "s3";
  /** Guarda y devuelve la referencia (ver arriba). */
  guardar(
    clave: string,
    datos: Uint8Array,
    tipo: string,
    opciones?: { publico?: boolean },
  ): Promise<string>;
  /** null si no existe. */
  leer(clave: string): Promise<{ datos: Uint8Array; tipo: string } | null>;
  existe(clave: string): Promise<boolean>;
  eliminar(clave: string): Promise<void>;
  /** Claves (y tamaños) bajo un prefijo. */
  listar(prefijo: string): Promise<{ clave: string; tamanio: number; fecha: Date }[]>;
  /** URL de descarga directa y temporal (S3) o la ruta de la app (local). */
  urlFirmada(clave: string, segundos: number, nombreDescarga?: string): Promise<string>;
  /** Para /api/health: ¿responde el bucket / la carpeta? */
  verificar(): Promise<void>;
}

const CLAVE_VALIDA = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.(pdf|png|jpg|webp|xlsx|dump)$/;
const TIPOS: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  dump: "application/octet-stream",
};
const PREFIJO_REF = "/api/publico/archivos/";

export type ExtensionArchivo = "pdf" | "png" | "jpg" | "webp" | "xlsx" | "dump";

export function esClaveValida(clave: string): boolean {
  return CLAVE_VALIDA.test(clave) && !clave.includes("..");
}

function tipoDe(clave: string): string {
  return TIPOS[clave.split(".").pop() ?? ""] ?? "application/octet-stream";
}

function assertClave(clave: string) {
  if (!esClaveValida(clave)) throw new Error(`Clave de almacenamiento inválida: ${clave}`);
}

// -----------------------------------------------------------------------------
// Local
// -----------------------------------------------------------------------------

export class StorageLocal implements StorageProvider {
  readonly nombre = "local" as const;
  constructor(private readonly raiz: string) {}

  private ruta(clave: string): string {
    assertClave(clave);
    return path.join(this.raiz, clave);
  }

  async guardar(clave: string, datos: Uint8Array): Promise<string> {
    const ruta = this.ruta(clave);
    await mkdir(path.dirname(ruta), { recursive: true });
    await writeFile(ruta, datos);
    return `${PREFIJO_REF}${clave}`;
  }

  async leer(clave: string) {
    try {
      return { datos: new Uint8Array(await readFile(this.ruta(clave))), tipo: tipoDe(clave) };
    } catch {
      return null;
    }
  }

  async existe(clave: string) {
    return stat(this.ruta(clave)).then(
      () => true,
      () => false,
    );
  }

  async eliminar(clave: string) {
    await rm(this.ruta(clave), { force: true });
  }

  async listar(prefijo: string) {
    const base = path.join(this.raiz, prefijo);
    const salida: { clave: string; tamanio: number; fecha: Date }[] = [];
    const recorrer = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await recorrer(p);
        else {
          const st = await stat(p);
          salida.push({
            clave: path.relative(this.raiz, p).split(path.sep).join("/"),
            tamanio: st.size,
            fecha: st.mtime,
          });
        }
      }
    };
    await recorrer(base);
    return salida;
  }

  async urlFirmada(clave: string) {
    assertClave(clave);
    return `${PREFIJO_REF}${clave}`;
  }

  async verificar() {
    await mkdir(this.raiz, { recursive: true });
    await stat(this.raiz);
  }
}

// -----------------------------------------------------------------------------
// S3 / Cloudflare R2
// -----------------------------------------------------------------------------

export class StorageS3 implements StorageProvider {
  readonly nombre = "s3" as const;
  constructor(
    private readonly cliente: S3Client,
    private readonly bucket: string,
    private readonly urlPublica?: string,
  ) {}

  async guardar(
    clave: string,
    datos: Uint8Array,
    tipo: string,
    opciones: { publico?: boolean } = {},
  ) {
    assertClave(clave);
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: clave,
        Body: datos,
        ContentType: tipo || tipoDe(clave),
      }),
    );
    if (opciones.publico && this.urlPublica)
      return `${this.urlPublica.replace(/\/$/, "")}/${clave}`;
    return `${PREFIJO_REF}${clave}`;
  }

  async leer(clave: string) {
    assertClave(clave);
    try {
      const r = await this.cliente.send(new GetObjectCommand({ Bucket: this.bucket, Key: clave }));
      const bytes = await r.Body!.transformToByteArray();
      return { datos: bytes, tipo: r.ContentType ?? tipoDe(clave) };
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async existe(clave: string) {
    try {
      await this.cliente.send(new HeadObjectCommand({ Bucket: this.bucket, Key: clave }));
      return true;
    } catch {
      return false;
    }
  }

  async eliminar(clave: string) {
    await this.cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: clave }));
  }

  async listar(prefijo: string) {
    const salida: { clave: string; tamanio: number; fecha: Date }[] = [];
    let token: string | undefined;
    do {
      const r = await this.cliente.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefijo,
          ContinuationToken: token,
        }),
      );
      for (const o of r.Contents ?? [])
        if (o.Key)
          salida.push({ clave: o.Key, tamanio: o.Size ?? 0, fecha: o.LastModified ?? new Date(0) });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return salida;
  }

  async urlFirmada(clave: string, segundos: number, nombreDescarga?: string) {
    assertClave(clave);
    return getSignedUrl(
      this.cliente,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: clave,
        ...(nombreDescarga
          ? { ResponseContentDisposition: `attachment; filename="${nombreDescarga}"` }
          : {}),
      }),
      // S3 v4 firma como máximo 7 días.
      { expiresIn: Math.min(segundos, 7 * 24 * 3600) },
    );
  }

  async verificar() {
    await this.cliente.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

// -----------------------------------------------------------------------------
// Selección por entorno
// -----------------------------------------------------------------------------

function clienteS3(): S3Client {
  const e = obtenerEnv();
  return new S3Client({
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
  });
}

let archivos: StorageProvider | null = null;
let backups: StorageProvider | null = null;

/** Archivos de la app (comprobantes, fotos, íconos). */
export function obtenerStorage(): StorageProvider {
  if (archivos) return archivos;
  const e = obtenerEnv();
  archivos =
    e.STORAGE_PROVIDER === "s3"
      ? new StorageS3(clienteS3(), e.S3_BUCKET!, e.S3_PUBLIC_URL)
      : new StorageLocal(path.resolve(e.STORAGE_DIR ?? ".storage"));
  return archivos;
}

/** Backups: bucket separado en S3 (S3_BACKUP_BUCKET); en local, `.storage/backups-db/`. */
export function obtenerStorageBackups(): StorageProvider {
  if (backups) return backups;
  const e = obtenerEnv();
  backups =
    e.STORAGE_PROVIDER === "s3"
      ? new StorageS3(clienteS3(), e.S3_BACKUP_BUCKET ?? e.S3_BUCKET!, undefined)
      : new StorageLocal(path.resolve(e.STORAGE_DIR ?? ".storage", "backups-db"));
  return backups;
}

/** Compat: `storage.guardar(...)` en el código existente. */
export const storage: StorageProvider = {
  get nombre() {
    return obtenerStorage().nombre;
  },
  guardar: (...a) => obtenerStorage().guardar(...a),
  leer: (c) => obtenerStorage().leer(c),
  existe: (c) => obtenerStorage().existe(c),
  eliminar: (c) => obtenerStorage().eliminar(c),
  listar: (p) => obtenerStorage().listar(p),
  urlFirmada: (...a) => obtenerStorage().urlFirmada(...a),
  verificar: () => obtenerStorage().verificar(),
};

/** Clave nueva e inadivinable: `carpeta/<prefijo>-<48 hex>.<ext>`. */
export function claveAleatoria(
  carpeta: string,
  prefijo: string,
  extension: ExtensionArchivo,
): string {
  const limpio = prefijo.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${carpeta}/${limpio}-${randomBytes(24).toString("hex")}.${extension}`;
}

/** Clave a partir de la referencia guardada en la DB. */
export function claveDeUrl(url: string): string | null {
  if (url.startsWith(PREFIJO_REF)) return url.slice(PREFIJO_REF.length);
  const publica = obtenerEnv().S3_PUBLIC_URL;
  if (publica && url.startsWith(publica)) return url.slice(publica.replace(/\/$/, "").length + 1);
  return null;
}

/** Absoluta con el dominio de la app (links que salen de la app, ej. WhatsApp). */
export function urlAbsoluta(ruta: string): string {
  if (/^https?:\/\//.test(ruta)) return ruta;
  const base = obtenerEnv().NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${ruta}`;
}

export const SIETE_DIAS_S = 7 * 24 * 3600;

/**
 * Link para mandar por WhatsApp: en S3, URL firmada de 7 días directo al
 * bucket; en local, la referencia de la app (absoluta).
 */
export async function urlCompartible(referencia: string): Promise<string> {
  const clave = claveDeUrl(referencia);
  if (!clave) return urlAbsoluta(referencia);
  const s = obtenerStorage();
  return s.nombre === "s3" ? s.urlFirmada(clave, SIETE_DIAS_S) : urlAbsoluta(referencia);
}

/** Extensión según el MIME detectado (ver validar-archivo.ts). */
export function extensionDeImagen(tipo: string): "png" | "jpg" | "webp" | null {
  if (tipo === "image/png") return "png";
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/webp") return "webp";
  return null;
}
