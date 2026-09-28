"use client";

import { useEffect } from "react";

import { CLAVE_ULTIMO_PANEL } from "@/lib/paneles";

/**
 * - Guarda el panel abierto: la PWA instalada arranca en el último usado.
 * - Aplica el acento del panel también en <html>, para que lo hereden los
 *   sheets y diálogos que se montan fuera del árbol del layout.
 */
export function RecordarPanel({
  slug,
  acento,
  textoAcento,
}: {
  slug: string;
  acento: string | null;
  textoAcento: string | null;
}) {
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_ULTIMO_PANEL, slug);
    } catch {
      /* modo privado / almacenamiento bloqueado */
    }
  }, [slug]);

  useEffect(() => {
    if (!acento) return;
    const raiz = document.documentElement.style;
    raiz.setProperty("--panel-accent", acento);
    if (textoAcento) raiz.setProperty("--panel-accent-foreground", textoAcento);
    return () => {
      raiz.removeProperty("--panel-accent");
      raiz.removeProperty("--panel-accent-foreground");
    };
  }, [acento, textoAcento]);

  return null;
}
