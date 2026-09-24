import { z } from "zod";

import { cantidad, id, sinDuplicados, textoOpcional } from "./common";

export const transferenciaItemSchema = z.object({
  varianteId: id,
  cantidad,
});

export const crearTransferenciaSchema = z
  .object({
    depositoOrigenId: id,
    depositoDestinoId: id,
    fecha: z.coerce.date().optional(),
    notas: textoOpcional(2000),
    items: z
      .array(transferenciaItemSchema)
      .min(1, "La transferencia debe tener al menos un ítem")
      .refine(
        (items) => sinDuplicados(items, (i) => i.varianteId),
        "Hay productos repetidos: sumá la cantidad",
      ),
  })
  .refine((t) => t.depositoOrigenId !== t.depositoDestinoId, {
    message: "El depósito de destino debe ser distinto al de origen",
    path: ["depositoDestinoId"],
  });

export type CrearTransferenciaInput = z.input<typeof crearTransferenciaSchema>;
export type CrearTransferencia = z.output<typeof crearTransferenciaSchema>;
