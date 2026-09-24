import { z } from "zod";

import { cantidad, id, monto, sinDuplicados, textoOpcional } from "./common";

export const compraItemSchema = z.object({
  varianteId: id,
  cantidad,
  costoUnitario: monto,
});

export const crearCompraSchema = z.object({
  proveedorId: id.optional(),
  depositoId: id,
  fecha: z.coerce.date().optional(),
  descuento: monto.default(0),
  notas: textoOpcional(2000),
  items: z
    .array(compraItemSchema)
    .min(1, "La compra debe tener al menos un ítem")
    .refine(
      (items) => sinDuplicados(items, (i) => i.varianteId),
      "Hay productos repetidos: sumá la cantidad",
    ),
});

export const anularCompraSchema = z.object({
  compraId: id,
  motivo: textoOpcional(500),
});

export type CrearCompraInput = z.input<typeof crearCompraSchema>;
export type CrearCompra = z.output<typeof crearCompraSchema>;
