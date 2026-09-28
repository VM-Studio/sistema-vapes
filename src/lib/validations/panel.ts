import { z } from "zod";

import { SLUG_VALIDO } from "@/lib/paneles";

import { texto } from "./common";

export const crearPanelSchema = z.object({
  nombre: texto(40),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Mínimo 2 caracteres")
    .max(40, "Máximo 40 caracteres")
    .regex(SLUG_VALIDO, "Solo minúsculas, números y guiones (ej: cosmetic, bazar-2)"),
  colorAcento: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal (#RRGGBB)")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  etiquetaEspecificacion: texto(30),
});

export type CrearPanel = z.output<typeof crearPanelSchema>;
