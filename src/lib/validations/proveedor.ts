import { z } from "zod";

import { cuitOpcional, emailOpcional, id, texto, textoOpcional } from "./common";

/** CUIT opcional: 11 dígitos con dígito verificador (acepta guiones). */
export const crearProveedorSchema = z.object({
  nombre: texto(150),
  cuit: cuitOpcional,
  telefono: textoOpcional(40),
  email: emailOpcional,
  direccion: textoOpcional(300),
  notas: textoOpcional(2000),
  activo: z.boolean().default(true),
});

export const actualizarProveedorSchema = crearProveedorSchema.extend({ id });

export type CrearProveedor = z.output<typeof crearProveedorSchema>;
export type ActualizarProveedor = z.output<typeof actualizarProveedorSchema>;

/** "20123456786" → "20-12345678-6". */
export function formatearCuit(cuit: string): string {
  return /^\d{11}$/.test(cuit)
    ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`
    : cuit;
}
