"use client";

import type { ActionResult } from "@/lib/action-result";
import { buscarEnCatalogo } from "@/features/offline/catalogo";

import { resolverCodigoAction } from "./actions";
import type { ResultadoResolucion } from "./tipos";

/**
 * Resolver un código escaneado:
 * 1. Catálogo offline (IndexedDB): instantáneo y funciona sin señal.
 * 2. Si no está y hay red: servidor (con caché de sesión de 5 min, así
 *    escanear 40 veces el mismo vape hace 1 viaje, no 40).
 * 3. Sin red y sin catálogo para ese código: "no encontrado en el catálogo offline".
 * Los "no existe" no se cachean (el código se puede dar de alta en cualquier momento).
 */
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { t: number; r: ResultadoResolucion }>();
const enVuelo = new Map<string, Promise<ActionResult<ResultadoResolucion>>>();

const normalizar = (codigo: string) => codigo.trim().replace(/\s+/g, "").toUpperCase();
const sinRed = () => typeof navigator !== "undefined" && navigator.onLine === false;

export async function resolverCodigo(codigo: string): Promise<ActionResult<ResultadoResolucion>> {
  const clave = normalizar(codigo);
  const local = await buscarEnCatalogo(clave);
  if (local) return { ok: true, data: { encontrado: true, variante: local } };
  if (sinRed()) {
    return {
      ok: false,
      error: {
        code: "OFFLINE_NO_ENCONTRADO",
        message: "Código no encontrado en el catálogo offline.",
      },
    };
  }
  const c = cache.get(clave);
  if (c && Date.now() - c.t < TTL_MS) return { ok: true, data: c.r };
  const pendiente = enVuelo.get(clave);
  if (pendiente) return pendiente;
  const promesa = resolverCodigoAction({ codigo: clave }).then(
    (r) => {
      enVuelo.delete(clave);
      if (r.ok && r.data.encontrado) cache.set(clave, { t: Date.now(), r: r.data });
      return r;
    },
    (): ActionResult<ResultadoResolucion> => {
      enVuelo.delete(clave);
      return {
        ok: false,
        error: { code: "NETWORK_ERROR", message: "Sin conexión con el servidor. Probá de nuevo." },
      };
    },
  );
  enVuelo.set(clave, promesa);
  return promesa;
}

/** Sin argumento: vacía todo (ej: después de confirmar un ingreso, el stock cambió). */
export function invalidarResoluciones(codigo?: string): void {
  if (codigo) cache.delete(normalizar(codigo));
  else cache.clear();
  // El stock cambió: que el catálogo offline se ponga al día (si no cambió nada, es un 304).
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(EVENTO_CATALOGO_DESACTUALIZADO));
}

export const EVENTO_CATALOGO_DESACTUALIZADO = "catalogo-desactualizado";
