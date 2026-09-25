import { z } from "zod";

import { emailOpcional, id, montoOpcional, texto, textoOpcional } from "./common";

/** DNI/CUIT/pasaporte: se guarda sin puntos, guiones ni espacios, en mayúsculas. */
const documentoOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/[.\-\s]/g, "").toUpperCase() : undefined))
  .refine((v) => v === undefined || /^[0-9A-Z]{6,20}$/.test(v), "Documento inválido");

export const crearClienteSchema = z.object({
  nombre: texto(100),
  apellido: textoOpcional(100),
  documento: documentoOpcional,
  telefono: textoOpcional(40),
  email: emailOpcional,
  direccion: textoOpcional(300),
  notas: textoOpcional(2000),
  activo: z.boolean().default(true),
  /** Solo lo puede fijar el OWNER (lo valida la acción). Vacío = no se le vende fiado. */
  limiteCredito: montoOpcional,
});

export const actualizarClienteSchema = crearClienteSchema.extend({ id });

export type CrearCliente = z.output<typeof crearClienteSchema>;
export type ActualizarCliente = z.output<typeof actualizarClienteSchema>;
