import { z } from "zod";

import { id, texto, textoOpcional } from "./common";

export const crearCategoriaSchema = z.object({
  nombre: texto(80),
  descripcion: textoOpcional(300),
  activo: z.boolean().default(true),
});
export const actualizarCategoriaSchema = crearCategoriaSchema.extend({ id });

export const crearMarcaSchema = z.object({
  nombre: texto(80),
  activo: z.boolean().default(true),
});
export const actualizarMarcaSchema = crearMarcaSchema.extend({ id });

export type CrearCategoria = z.output<typeof crearCategoriaSchema>;
export type ActualizarCategoria = z.output<typeof actualizarCategoriaSchema>;
export type CrearMarca = z.output<typeof crearMarcaSchema>;
export type ActualizarMarca = z.output<typeof actualizarMarcaSchema>;
