"use client";

import type { ActionResult } from "@/lib/action-result";

import { resolverCodigoAction } from "./actions";
import type { ResultadoResolucion } from "./tipos";

/**
 * Caché de resoluciones durante la sesión de escaneo (5 min): escanear 40
 * veces el mismo vape hace 1 viaje al servidor, no 40. Se invalida después de
 * operaciones que cambian stock o al asociar un código nuevo. Los "no existe"
 * no se guardan.
 */
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { t: number; r: ResultadoResolucion }>();
const enVuelo = new Map<string, Promise<ActionResult<ResultadoResolucion>>>();

export async function resolverCodigo(codigo: string): Promise<ActionResult<ResultadoResolucion>> {
  const clave = codigo.trim().replace(/\s+/g, "").toUpperCase();
  const c = cache.get(clave);
  if (c && Date.now() - c.t < TTL_MS) return { ok: true, data: c.r };
  const pendiente = enVuelo.get(clave);
  if (pendiente) return pendiente;
  const promesa = resolverCodigoAction({ codigo: clave }).then(
    (r) => {
      enVuelo.delete(clave);
      // Solo los encontrados: un código desconocido puede darse de alta en cualquier momento
      // (crear producto, asociar desde otra pantalla o dispositivo) y hay que volver a preguntar.
      if (r.ok && r.data.encontrado) cache.set(clave, { t: Date.now(), r: r.data });
      return r;
    },
    (): ActionResult<ResultadoResolucion> => {
      // Sin conexión o servidor caído: no queda "en vuelo" para siempre.
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
  if (codigo) cache.delete(codigo.trim().replace(/\s+/g, "").toUpperCase());
  else cache.clear();
}
