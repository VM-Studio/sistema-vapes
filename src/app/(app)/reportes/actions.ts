"use server";

import { z } from "zod";

import { actionHandler } from "@/server/action-handler";
import { pdfDeReporte } from "@/server/reportes/exportar";
import { claveAleatoria, storage } from "@/server/storage";

/**
 * Guarda el PDF del reporte con una URL pública inadivinable y la devuelve,
 * para mandarla por WhatsApp (el resumen mensual del 1° de cada mes).
 * Los permisos son los mismos que para exportarlo.
 */
export const compartirReporteAction = actionHandler(async (input: unknown) => {
  const { slug, query } = z
    .object({ slug: z.string().max(60), query: z.string().max(500) })
    .parse(input);
  const { pdf, doc, meta } = await pdfDeReporte(slug, new URLSearchParams(query));
  const url = await storage.guardar(
    claveAleatoria("reportes", slug, "pdf"),
    pdf,
    "application/pdf",
  );
  return {
    url,
    texto: `${doc.titulo} — ${meta.negocio}\n${doc.filtros.map((f) => `${f.etiqueta}: ${f.valor}`).join("\n")}`,
  };
});
