import { z } from "zod";

import { emailOpcional, id, texto, textoOpcional } from "./common";

/**
 * Teléfono normalizado: "+54" + solo dígitos. Espejo EXACTO de la función SQL
 * fn_normalizar_telefono (migración reforma_multipanel): se quitan los
 * no-dígitos y los ceros a la izquierda; si ya empieza con 54 y tiene al menos
 * 12 dígitos es un número con código de país (+ + dígitos); si no, se le
 * antepone +54. Vacío → null.
 */
export function normalizarTelefono(telefono: string | null | undefined): string | null {
  const digitos = (telefono ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digitos) return null;
  return digitos.startsWith("54") && digitos.length >= 12 ? `+${digitos}` : `+54${digitos}`;
}

/** Mismo CHECK que la DB (Cliente_telefono_chk). */
export const TELEFONO_NORMALIZADO = /^\+54[0-9]{6,13}$/;

/** DNI/CUIT/pasaporte: se guarda sin puntos, guiones ni espacios, en mayúsculas. */
const documentoOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/[.\-\s]/g, "").toUpperCase() : undefined))
  .refine((v) => v === undefined || /^[0-9A-Z]{6,20}$/.test(v), "Documento inválido");

const telefonoOpcional = z
  .string()
  .trim()
  .max(40, "Máximo 40 caracteres")
  .optional()
  .transform((v) => normalizarTelefono(v) ?? undefined)
  .refine(
    (v) => v === undefined || TELEFONO_NORMALIZADO.test(v),
    "Teléfono inválido: tiene que tener entre 6 y 13 dígitos (con código de área)",
  );

export const crearClienteSchema = z.object({
  nombre: texto(100),
  apellido: textoOpcional(100),
  documento: documentoOpcional,
  telefono: telefonoOpcional,
  email: emailOpcional,
  direccion: textoOpcional(300),
  notas: textoOpcional(2000),
  activo: z.boolean().default(true),
});

export const actualizarClienteSchema = crearClienteSchema.extend({ id });

export type CrearCliente = z.output<typeof crearClienteSchema>;
export type ActualizarCliente = z.output<typeof actualizarClienteSchema>;
