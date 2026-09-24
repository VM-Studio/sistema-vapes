import { z } from "zod";

import { cuitOpcional, emailOpcional, id, texto, textoOpcional } from "./common";

export const crearProveedorSchema = z.object({
  nombre: texto(150),
  cuit: cuitOpcional,
  telefono: textoOpcional(40),
  email: emailOpcional,
  direccion: textoOpcional(300),
  notas: textoOpcional(2000),
  activo: z.boolean().default(true),
});

export const actualizarProveedorSchema = crearProveedorSchema.partial().extend({ id });

export type CrearProveedor = z.output<typeof crearProveedorSchema>;
export type ActualizarProveedor = z.output<typeof actualizarProveedorSchema>;
