"use client";

import type { ActionResult } from "@/lib/action-result";

/**
 * Abre en otra pestaña una URL que recién se conoce después de una Server
 * Action (WhatsApp, PDF). La pestaña se abre en el mismo tap —si no, el
 * navegador la bloquea como popup— y se redirige cuando llega la URL.
 * Devuelve el mensaje de error (y cierra la pestaña) si la acción falla.
 */
export async function abrirEnPestana(
  obtener: () => Promise<ActionResult<{ url: string }> | null>,
): Promise<string | null> {
  const pestana = window.open("about:blank", "_blank");
  const r = await obtener().catch(() => null);
  if (!r || !r.ok) {
    pestana?.close();
    return r ? r.error.message : "Sin conexión con el servidor. Probá de nuevo.";
  }
  if (pestana) pestana.location.href = r.data.url;
  else window.location.href = r.data.url;
  return null;
}
