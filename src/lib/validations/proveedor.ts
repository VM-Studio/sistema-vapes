import { Moneda } from "@prisma/client";
import { z } from "zod";

import { id, monto, sinDuplicados, texto, textoOpcional } from "./common";
import { normalizarTelefono, TELEFONO_NORMALIZADO } from "./cliente";

/** Teléfono opcional, normalizado a "+54…" (mismo CHECK que la DB). */
const telefonoProveedor = z
  .string()
  .trim()
  .optional()
  .transform((v) => normalizarTelefono(v) ?? undefined)
  .refine(
    (v) => v === undefined || TELEFONO_NORMALIZADO.test(v),
    "Teléfono inválido: tiene que tener entre 6 y 13 dígitos (con código de área)",
  );

export const monedaSchema = z.enum(Moneda).default(Moneda.ARS);

/** Un producto que vende el proveedor, con su precio. */
export const productoDeProveedorSchema = z.object({
  productoId: id,
  precio: monto,
  moneda: monedaSchema,
});

const datosProveedor = {
  nombre: texto(150),
  telefono: telefonoProveedor,
  nombreTienda: texto(150),
  notas: textoOpcional(2000),
};

export const crearProveedorSchema = z.object({
  ...datosProveedor,
  /** Opcional: se puede guardar el proveedor sin productos. */
  productos: z
    .array(productoDeProveedorSchema)
    .max(500)
    .default([])
    .refine(
      (ps) => sinDuplicados(ps, (p) => p.productoId),
      "Hay productos repetidos: dejá una sola fila por producto",
    ),
});

export const actualizarProveedorSchema = z.object({
  id,
  ...datosProveedor,
  activo: z.boolean().default(true),
});

export const asignarProductoSchema = productoDeProveedorSchema.extend({ proveedorId: id });

export const quitarProductoSchema = z.object({ proveedorId: id, productoId: id });

export type CrearProveedorInput = z.input<typeof crearProveedorSchema>;
export type CrearProveedor = z.output<typeof crearProveedorSchema>;
export type ActualizarProveedor = z.output<typeof actualizarProveedorSchema>;
export type ProductoDeProveedor = z.output<typeof productoDeProveedorSchema>;

/** Link de WhatsApp: "+5491122334455" → "https://wa.me/5491122334455". */
export function enlaceWhatsApp(telefono: string): string {
  return `https://wa.me/${telefono.replace(/\D/g, "")}`;
}

/** "+5491122334455" → "11 2233-4455" aproximado para mostrar (sin el +54 9). */
export function formatearTelefono(telefono: string): string {
  const d = telefono.replace(/\D/g, "").replace(/^549?/, "");
  if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
