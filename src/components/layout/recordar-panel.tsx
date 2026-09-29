"use client";

import { useEffect } from "react";

import { CLAVE_ULTIMO_PANEL } from "@/lib/paneles";

/** Guarda el panel abierto: la PWA instalada arranca en el último usado. */
export function RecordarPanel({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_ULTIMO_PANEL, slug);
    } catch {
      /* modo privado / almacenamiento bloqueado */
    }
  }, [slug]);

  return null;
}
