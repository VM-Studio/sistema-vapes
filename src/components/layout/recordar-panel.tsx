"use client";

import { useEffect } from "react";

import { COOKIE_ULTIMO_PANEL } from "@/config/ui";
import { CLAVE_ULTIMO_PANEL } from "@/lib/paneles";

/**
 * Guarda el panel abierto: la PWA instalada arranca en el último usado
 * (localStorage) y las pantallas globales lo muestran con su barra y su menú
 * lateral (cookie, la lee el servidor).
 */
export function RecordarPanel({ slug }: { slug: string }) {
  useEffect(() => {
    document.cookie = `${COOKIE_ULTIMO_PANEL}=${slug}; path=/; max-age=31536000; samesite=lax`;
    try {
      localStorage.setItem(CLAVE_ULTIMO_PANEL, slug);
    } catch {
      /* modo privado / almacenamiento bloqueado */
    }
  }, [slug]);

  return null;
}
