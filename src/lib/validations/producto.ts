import { z } from "zod";

import { codigoBarras, codigoBarrasOpcional, id, monto, texto, textoOpcional } from "./common";

export const NOMBRE_VARIANTE_UNICA = "Único";

const sku = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,32}$/, "SKU inválido (3-32 letras, números o guiones)");

export const varianteSchema = z.object({
  nombre: texto(100),
  sku: sku.optional(), // si falta, se genera PRD-XXXXXX
  codigoBarras: codigoBarrasOpcional,
  codigosAlternativos: z
    .array(z.object({ codigo: codigoBarras, descripcion: textoOpcional(200) }))
    .default([]),
  precioCosto: monto,
  precioVenta: monto,
  stockMinimo: z.number().int().nonnegative("No puede ser negativo").default(0),
  activo: z.boolean().default(true),
});

/** Para productos sin variantes: los mismos datos, sin nombre (se usa "Único"). */
const varianteUnicaSchema = varianteSchema.omit({ nombre: true });

const baseProducto = z.object({
  nombre: texto(150),
  descripcion: textoOpcional(2000),
  categoriaId: id,
  marcaId: id.optional(),
  imagenUrl: z.url("URL inválida").optional(),
  activo: z.boolean().default(true),
});

/**
 * Creación anidada producto + variantes.
 * - tieneVariantes=true  → `variantes` con al menos una (ej: sabores).
 * - tieneVariantes=false → `variante` con precios/código; se crea como "Único".
 * La salida siempre trae `variantes: [...]` para que el servicio no distinga casos.
 */
export const crearProductoSchema = z
  .discriminatedUnion("tieneVariantes", [
    baseProducto.extend({
      tieneVariantes: z.literal(true),
      variantes: z.array(varianteSchema).min(1, "Agregá al menos una variante"),
    }),
    baseProducto.extend({
      tieneVariantes: z.literal(false),
      variante: varianteUnicaSchema,
    }),
  ])
  .transform((p) => {
    if (p.tieneVariantes) return p;
    const { variante, ...resto } = p;
    return { ...resto, variantes: [{ ...variante, nombre: NOMBRE_VARIANTE_UNICA }] };
  })
  .superRefine((p, ctx) => {
    const vistos = new Map<string, string>();
    const nombres = new Set<string>();
    p.variantes.forEach((v, i) => {
      const nombre = v.nombre.toLocaleLowerCase("es");
      if (nombres.has(nombre)) {
        ctx.addIssue({
          code: "custom",
          message: `Variante repetida: ${v.nombre}`,
          path: ["variantes", i, "nombre"],
        });
      }
      nombres.add(nombre);

      const codigos = [v.codigoBarras, ...v.codigosAlternativos.map((c) => c.codigo)].filter(
        (c): c is string => c !== undefined,
      );
      for (const codigo of codigos) {
        const otro = vistos.get(codigo);
        if (otro !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: `El código ${codigo} está repetido (también en ${otro})`,
            path: ["variantes", i, "codigoBarras"],
          });
        }
        vistos.set(codigo, v.nombre);
      }
    });
  });

export const actualizarProductoSchema = baseProducto.partial().extend({ id });

export const crearVarianteSchema = varianteSchema.extend({ productoId: id });

export const actualizarVarianteSchema = varianteSchema
  .omit({ codigosAlternativos: true })
  .partial()
  .extend({
    id,
    // null explícito = quitar el código de barras
    codigoBarras: codigoBarrasOpcional.nullable(),
  });

export const codigoAlternativoSchema = z.object({
  varianteId: id,
  codigo: codigoBarras,
  descripcion: textoOpcional(200),
});

export type CrearProductoInput = z.input<typeof crearProductoSchema>;
export type CrearProducto = z.output<typeof crearProductoSchema>;
export type ActualizarProducto = z.output<typeof actualizarProductoSchema>;
export type CrearVariante = z.output<typeof crearVarianteSchema>;
export type ActualizarVariante = z.output<typeof actualizarVarianteSchema>;
