import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { VarianteOffline } from "@/server/services/catalogo-offline.service";

/**
 * IndexedDB del modo sin conexión (NO localStorage: el catálogo puede pesar
 * varios MB y localStorage es síncrono y limitado). La usan la página y el
 * service worker (Background Sync).
 */

export type TipoOperacion = "INGRESO" | "RECUENTO" | "TRANSFERENCIA";
export type EstadoCola = "PENDIENTE" | "ENVIANDO" | "RECHAZADA";

export interface OperacionCola {
  idOperacion: string;
  tipo: TipoOperacion;
  payload: unknown;
  /** ISO: cuándo se confirmó en el celular. */
  creadaEn: string;
  usuarioId: string;
  estado: EstadoCola;
  intentos: number;
  motivo?: string | null;
  /** Resumen legible para la lista ("Ingreso · 12 u. · Galpón 1"). */
  resumen: string;
}

export interface PermisosOffline {
  ingresar: boolean;
  contar: boolean;
  transferir: boolean;
  completar: boolean;
}

export interface MetaCatalogo {
  clave: "catalogo";
  version: string;
  /** ms epoch de la última sincronización exitosa (o 304). */
  sincronizadoEn: number;
  usuarioId: string;
  usuarioNombre: string;
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
  permisos: PermisosOffline;
  cantidad: number;
}

interface EsquemaOffline extends DBSchema {
  variantes: { key: string; value: VarianteOffline; indexes: { porCodigo: string } };
  meta: { key: string; value: MetaCatalogo };
  cola: { key: string; value: OperacionCola; indexes: { porCreada: string } };
}

export const NOMBRE_DB = "gestion-offline";
let conexion: Promise<IDBPDatabase<EsquemaOffline>> | null = null;

export function abrirDb(): Promise<IDBPDatabase<EsquemaOffline>> {
  conexion ??= openDB<EsquemaOffline>(NOMBRE_DB, 1, {
    upgrade(db) {
      const variantes = db.createObjectStore("variantes", { keyPath: "varianteId" });
      variantes.createIndex("porCodigo", "codigos", { multiEntry: true });
      db.createObjectStore("meta", { keyPath: "clave" });
      const cola = db.createObjectStore("cola", { keyPath: "idOperacion" });
      cola.createIndex("porCreada", "creadaEn");
    },
    blocking() {
      // Otra pestaña abrió una versión nueva: soltamos la conexión.
      void conexion?.then((d) => d.close());
      conexion = null;
    },
  });
  return conexion;
}

/** Canal para avisar cambios de la cola entre pestañas y el service worker. */
export const CANAL_COLA = "gestion-cola-escaner";

export function avisarCambioCola(): void {
  try {
    const c = new BroadcastChannel(CANAL_COLA);
    c.postMessage({ tipo: "cola" });
    c.close();
  } catch {
    /* BroadcastChannel no disponible */
  }
}
