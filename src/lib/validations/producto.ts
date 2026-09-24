import { z } from "zod";

import {
  codigoBarras,
  codigoBarrasOpcional,
  enteroNoNegativo,
  id,
  monto,
  montoOpcional,
  texto,
  textoOpcional,
  vacioAUndefined,
} from "./common";

export const NOMBRE_VARIANTE_UNICA = "Único";

/** SKU: opcional (se genera {prefijo}-XXXXXX); si viene, mayúsculas sin espacios. */
export const skuOpcional = z.preprocess(
  vacioAUndefined,
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,32}$/, "SKU inválido (3-32 letras, números o guiones)")
    .optional(),
);

const idOpcional = z.preprocess(vacioAUndefined, id.optional());

/** Una fila del editor de variantes. `id` presente = variante existente (edición). */
export const varianteFormSchema = z.object({
  id: idOpcional,
  nombre: texto(100),
  sku: skuOpcional,
  codigoBarras: codigoBarrasOpcional,
  precioCosto: monto,
  precioVenta: monto,
  stockMinimo: enteroNoNegativo.default(0),
  activo: z.boolean().default(true),
});

/**
 * Producto + variantes, para crear y para editar (mismo formulario).
 * - tieneVariantes=false => exactamente una variante; se llama "Único".
 * - Sin nombres de variante ni códigos de barras repetidos dentro del formulario.
 *   (La unicidad contra la DB la verifica el servicio, y la DB de última.)
 */
export const productoSchema = z
  .object({
    nombre: texto(150),
    descripcion: textoOpcional(2000),
    categoriaId: id,
    marcaId: idOpcional,
    imagenUrl: z.preprocess(vacioAUndefined, z.url("URL inválida").optional()),
    activo: z.boolean().default(true),
    tieneVariantes: z.boolean(),
    variantes: z.array(varianteFormSchema).min(1, "Agregá al menos una variante").max(200),
  })
  .superRefine((p, ctx) => {
    if (!p.tieneVariantes && p.variantes.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Un producto sin variantes tiene exactamente una",
        path: ["variantes"],
      });
    }
    const nombres = new Map<string, number>();
    const codigos = new Map<string, number>();
    const skus = new Map<string, number>();
    p.variantes.forEach((v, i) => {
      const nombre = v.nombre.toLocaleLowerCase("es");
      if (p.tieneVariantes && nombres.has(nombre)) {
        ctx.addIssue({
          code: "custom",
          message: `Variante repetida: ${v.nombre}`,
          path: ["variantes", i, "nombre"],
        });
      }
      nombres.set(nombre, i);
      if (v.codigoBarras) {
        const otra = codigos.get(v.codigoBarras);
        if (otra !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: `Código repetido (también en la variante ${otra + 1})`,
            path: ["variantes", i, "codigoBarras"],
          });
        }
        codigos.set(v.codigoBarras, i);
      }
      if (v.sku) {
        if (skus.has(v.sku)) {
          ctx.addIssue({
            code: "custom",
            message: "SKU repetido en el formulario",
            path: ["variantes", i, "sku"],
          });
        }
        skus.set(v.sku, i);
      }
    });
  })
  .transform((p) =>
    p.tieneVariantes
      ? p
      : { ...p, variantes: p.variantes.map((v) => ({ ...v, nombre: NOMBRE_VARIANTE_UNICA })) },
  );

export const actualizarProductoSchema = z.object({ id, datos: productoSchema });

export const codigoAlternativoSchema = z.object({
  varianteId: id,
  codigo: codigoBarras,
  descripcion: textoOpcional(200),
});

export const verificarCodigoSchema = z.object({
  codigo: codigoBarras,
  excluirVarianteId: idOpcional,
});

/** Cambio manual de precios (una o varias variantes). */
export const actualizarPreciosSchema = z
  .object({
    varianteIds: z.array(id).min(1).max(500),
    precioCosto: montoOpcional,
    precioVenta: montoOpcional,
    motivo: textoOpcional(300),
  })
  .refine((d) => d.precioCosto !== undefined || d.precioVenta !== undefined, {
    message: "Indicá al menos un precio",
    path: ["precioVenta"],
  });

export const REDONDEOS = [1, 10, 100] as const;

/** Aumento (o rebaja) porcentual masivo. */
export const aumentoPorcentualSchema = z.object({
  filtro: z.object({
    categoriaId: idOpcional,
    marcaId: idOpcional,
    productoId: idOpcional,
  }),
  porcentaje: z.preprocess(
    vacioAUndefined,
    z.coerce
      .number({ error: "Ingresá un porcentaje" })
      .min(-90, "Mínimo -90%")
      .max(1000, "Máximo 1000%")
      .refine((n) => n !== 0, "El porcentaje no puede ser 0")
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, "Máximo 2 decimales"),
  ),
  aplicarA: z.enum(["costo", "venta", "ambos"]),
  redondeo: z.coerce
    .number()
    .refine(
      (n): n is (typeof REDONDEOS)[number] => (REDONDEOS as readonly number[]).includes(n),
      "Redondeo inválido",
    ),
  motivo: textoOpcional(300),
});

export const ORDENES_PRODUCTO = ["nombre", "-nombre", "reciente"] as const;

export const listarProductosSchema = z.object({
  q: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()),
  categoriaId: idOpcional,
  marcaId: idOpcional,
  estado: z.enum(["activos", "inactivos", "todos"]).catch("activos"),
  conStockBajo: z.preprocess((v) => v === true || v === "1" || v === "true", z.boolean()),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(20),
  orden: z.enum(ORDENES_PRODUCTO).catch("nombre"),
});

export type ProductoInput = z.input<typeof productoSchema>;
export type Producto = z.output<typeof productoSchema>;
export type VarianteForm = z.output<typeof varianteFormSchema>;
export type ActualizarPrecios = z.output<typeof actualizarPreciosSchema>;
export type AumentoPorcentual = z.output<typeof aumentoPorcentualSchema>;
export type FiltrosProductos = z.output<typeof listarProductosSchema>;
