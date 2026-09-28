import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { VarianteOffline } from "@/server/services/catalogo-offline.service";

/**
 * IndexedDB del escáner sin conexión (NO localStorage: el catálogo puede pesar
 * varios MB y localStorage es síncrono y limitado). SOLO LECTURA: guarda el
 * último catálogo de cada panel para reconocer códigos sin señal; no hay cola
 * de operaciones.
 *
 * Cada panel tiene su propio catálogo: las variantes llevan `panelId` y sus
 * códigos se indexan como "{panelId}|{codigo}", así el mismo EAN en dos
 * paneles no se pisa y una búsqueda nunca cruza de panel.
 */

export interface VarianteGuardada extends VarianteOffline {
  /** "{panelId}:{varianteId}" */
  clave: string;
  panelId: string;
  /** "{panelId}|{codigo}" por cada código (índice multiEntry). */
  codigosPanel: string[];
}

export interface MetaCatalogo {
  panelId: string;
  panelSlug: string;
  panelNombre: string;
  version: string;
  /** ms epoch de la última sincronización exitosa (o 304). */
  sincronizadoEn: number;
  usuarioId: string;
  usuarioNombre: string;
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
  cantidad: number;
}

interface EsquemaOffline extends DBSchema {
  variantes: {
    key: string;
    value: VarianteGuardada;
    indexes: { porCodigo: string; porPanel: string };
  };
  catalogos: { key: string; value: MetaCatalogo };
}

export const NOMBRE_DB = "gestion-offline";
const VERSION_DB = 3;
let conexion: Promise<IDBPDatabase<EsquemaOffline>> | null = null;

export const claveCodigo = (panelId: string, codigo: string) => `${panelId}|${codigo}`;

export function abrirDb(): Promise<IDBPDatabase<EsquemaOffline>> {
  conexion ??= openDB<EsquemaOffline>(NOMBRE_DB, VERSION_DB, {
    upgrade(db) {
      // Versiones anteriores (otra forma de los datos) no sirven: se rehace de cero.
      for (const store of [...db.objectStoreNames]) db.deleteObjectStore(store);
      const variantes = db.createObjectStore("variantes", { keyPath: "clave" });
      variantes.createIndex("porCodigo", "codigosPanel", { multiEntry: true });
      variantes.createIndex("porPanel", "panelId");
      db.createObjectStore("catalogos", { keyPath: "panelId" });
    },
    blocking() {
      // Otra pestaña abrió una versión nueva: soltamos la conexión.
      void conexion?.then((d) => d.close());
      conexion = null;
    },
  });
  return conexion;
}
