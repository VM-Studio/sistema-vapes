import { z } from "zod";

import { id } from "./common";

export const FORMATOS_ETIQUETA = {
  avery65: { label: "A4 · 65 por hoja (38,1 × 21,2 mm)" },
  a4_3x8: { label: "A4 · 3 × 8 (70 × 37 mm)" },
  a4_2x7: { label: "A4 · 2 × 7 (99,1 × 38,1 mm)" },
  rollo50x30: { label: "Rollo térmico 50 × 30 mm" },
} as const;

export type FormatoEtiqueta = keyof typeof FORMATOS_ETIQUETA;

export const etiquetasSchema = z.object({
  items: z
    .array(z.object({ varianteId: id, cantidad: z.coerce.number().int().min(1).max(500) }))
    .min(1, "Elegí al menos un producto")
    .max(300),
  formato: z.enum(Object.keys(FORMATOS_ETIQUETA) as [FormatoEtiqueta, ...FormatoEtiqueta[]]),
  mostrarPrecio: z.boolean().default(true),
});

export type PedidoEtiquetas = z.output<typeof etiquetasSchema>;
