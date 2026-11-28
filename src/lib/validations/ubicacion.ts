import { z } from "zod";

import { id, textoOpcional } from "./common";

const nombre = z
  .string()
  .trim()
  .min(1, "Poné un nombre (ej.: Estante A · fila 2)")
  .max(80, "Máximo 80 caracteres");

export const crearUbicacionSchema = z.object({
  nombre,
  descripcion: textoOpcional(200),
});

export const actualizarUbicacionSchema = crearUbicacionSchema.extend({ id });

export const ubicacionIdSchema = z.object({ id });

export const moverUbicacionSchema = z.object({
  id,
  direccion: z.union([z.literal(-1), z.literal(1)]),
});

export const asignarUbicacionSchema = z.object({
  productoIds: z.array(id).min(1).max(2000),
  /** null = sin ubicación. */
  ubicacionId: id.nullable(),
});

export type CrearUbicacion = z.output<typeof crearUbicacionSchema>;
