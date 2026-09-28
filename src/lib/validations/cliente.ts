import { z } from "zod";

import { id, texto, textoOpcional } from "./common";

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

export const MENSAJE_TELEFONO_INVALIDO =
  "Teléfono inválido: tiene que tener entre 6 y 13 dígitos (con código de área)";

/** Teléfono válido y normalizado, o null. */
export function telefonoValido(telefono: string | null | undefined): string | null {
  const t = normalizarTelefono(telefono);
  return t && TELEFONO_NORMALIZADO.test(t) ? t : null;
}

/** Teléfono obligatorio: sale normalizado ("+54…"). */
export const telefonoObligatorio = z
  .string({ error: "Ingresá el teléfono" })
  .trim()
  .max(40, "Máximo 40 caracteres")
  .transform((v) => normalizarTelefono(v) ?? "")
  .refine((v) => v !== "", "Ingresá el teléfono")
  .refine((v) => v === "" || TELEFONO_NORMALIZADO.test(v), MENSAJE_TELEFONO_INVALIDO);

/** Link de WhatsApp para un teléfono normalizado (+54…). */
export function linkWhatsApp(telefono: string): string {
  return `https://wa.me/${telefono.replace(/\D/g, "")}`;
}

/** "+541155551234" → "+54 11 5555 1234" (solo para mostrar). */
export function mostrarTelefono(telefono: string): string {
  const d = telefono.replace(/^\+54/, "");
  if (d.length === 10) return `+54 ${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("9"))
    return `+54 9 ${d.slice(1, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  return telefono;
}

export const crearClienteSchema = z.object({
  nombre: texto(100),
  telefono: telefonoObligatorio,
  notas: textoOpcional(2000),
});

export const actualizarClienteSchema = crearClienteSchema.extend({ id });

export const buscarClientesSchema = z.object({ q: z.string().trim().max(100).default("") });

export const telefonoConsultaSchema = z.object({ telefono: z.string().trim().max(40) });

export type CrearCliente = z.output<typeof crearClienteSchema>;
export type ActualizarCliente = z.output<typeof actualizarClienteSchema>;
