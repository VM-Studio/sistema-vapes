import { z } from "zod";

import { enteroPositivo, id, sinDuplicados, textoOpcional } from "./common";
import { motivoAjuste } from "./movimiento";

export const transferenciaItemSchema = z.object({
  varianteId: id,
  cantidad: enteroPositivo,
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
      .max(500)
      .refine(
        (items) => sinDuplicados(items, (i) => i.varianteId),
        "Hay productos repetidos: sumá la cantidad",
      ),
  })
  .refine((t) => t.depositoOrigenId !== t.depositoDestinoId, {
    message: "El depósito de destino debe ser distinto al de origen",
    path: ["depositoDestinoId"],
  });

export const completarTransferenciaSchema = z.object({ id });

export const anularTransferenciaSchema = z.object({ id, motivo: motivoAjuste });

export type CrearTransferenciaInput = z.input<typeof crearTransferenciaSchema>;
export type CrearTransferencia = z.output<typeof crearTransferenciaSchema>;

/** Transferir un sabor a otro galpón desde la pantalla de stock (se completa en el acto). */
export const transferenciaRapidaSchema = z
  .object({
    varianteId: id,
    depositoOrigenId: id,
    depositoDestinoId: id,
    cantidad: enteroPositivo,
    notas: textoOpcional(500),
  })
  .refine((t) => t.depositoOrigenId !== t.depositoDestinoId, {
    message: "El galpón de destino debe ser distinto al de origen",
    path: ["depositoDestinoId"],
  });

export type TransferenciaRapida = Omit<z.output<typeof transferenciaRapidaSchema>, "notas"> & {
  notas?: string;
};
