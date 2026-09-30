import { z } from "zod";

import { prefijoPanel } from "@/lib/paneles";

import { enteroPositivo, id, sinDuplicados, textoOpcional } from "./common";
import { motivoAjuste } from "./movimiento";

/** ID visible de una transferencia: VAP-T-000001. */
export function formatearIdTransferencia(slug: string, numero: number): string {
  return `${prefijoPanel(slug)}-T-${String(numero).padStart(6, "0")}`;
}

export const transferenciaItemSchema = z.object({
  varianteId: id,
  cantidad: enteroPositivo,
});

export const crearTransferenciaSchema = z
  .object({
    depositoOrigenId: id,
    depositoDestinoId: id,
    fecha: z.coerce.date().optional(),
    observacion: textoOpcional(2000),
    items: z
      .array(transferenciaItemSchema)
      .min(1, "La transferencia debe tener al menos un ítem")
      .max(500)
      .refine(
        (items) => sinDuplicados(items, (i) => i.varianteId),
        "Hay productos repetidos: sumá la cantidad",
      ),
  })
  .refine((t) => t.depositoOrigenId !== t.depositoDestinoId, {
    message: "El galpón de destino tiene que ser distinto al de origen",
    path: ["depositoDestinoId"],
  });

export const completarTransferenciaSchema = z.object({ id });

export const anularTransferenciaSchema = z.object({ id, motivo: motivoAjuste });

export const remitoTransferenciaSchema = z.object({ id });

export type CrearTransferenciaInput = z.input<typeof crearTransferenciaSchema>;
export type CrearTransferencia = z.output<typeof crearTransferenciaSchema>;
