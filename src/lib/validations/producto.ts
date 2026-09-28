import { z } from "zod";

import {
  cantidad,
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

/**
 * CATÁLOGO: producto = marca + modelo + especificación ("Elf Bar" + "BC" +
 * "5000"), con un precio de venta para todos sus sabores. Cada sabor es una
 * Variante (con su código de barras y, opcionalmente, un precio propio).
 * Un producto sin sabor tiene una sola variante "Único" que la UI no muestra.
 */
export const NOMBRE_VARIANTE_UNICA = "Único";

/** El sabor para mostrar: null si es la variante "Único" de un producto sin sabores. */
export function saborVisible(nombreVariante: string): string | null {
  return nombreVariante === NOMBRE_VARIANTE_UNICA ? null : nombreVariante;
}

/** "Elf Bar BC 5000 — Mango", o solo el producto si no tiene sabor. */
export function nombreConSabor(nombreCompletoProducto: string, nombreVariante: string): string {
  const sabor = saborVisible(nombreVariante);
  return sabor ? `${nombreCompletoProducto} — ${sabor}` : nombreCompletoProducto;
}

/** Misma normalización que el trigger de la DB (especificacionNorm): minúsculas y sin espacios. */
export function normalizarEspecificacion(especificacion: string): string {
  return especificacion.replace(/\s+/g, "").toLowerCase();
}

/** Espacios repetidos → uno (igual que hace la DB con modelo y especificación). */
export const colapsarEspacios = (s: string) => s.trim().replace(/\s+/g, " ");

const idOpcional = z.preprocess(vacioAUndefined, id.optional());
const especificacion = z
  .string()
  .trim()
  .max(60, "Máximo 60 caracteres")
  .optional()
  .transform((v) => colapsarEspacios(v ?? ""));

/** Una fila de sabor del formulario. `id` presente = sabor existente (edición). */
export const saborFormSchema = z.object({
  id: idOpcional,
  sabor: textoOpcional(100),
  codigoBarras: codigoBarrasOpcional,
  /** Precio propio del sabor (vacío = usa el del producto). */
  precioVenta: montoOpcional,
  stockMinimo: enteroNoNegativo.default(0),
  activo: z.boolean().default(true),
});

/**
 * Producto completo (crear y editar). Con una sola fila sin sabor, el
 * producto no tiene sabores (variante "Único"). Con varias, todas llevan sabor
 * y no se repiten; tampoco los códigos dentro del formulario (la unicidad
 * contra el panel la verifica el servicio).
 */
export const productoSchema = z
  .object({
    marca: texto(80),
    modelo: texto(120),
    especificacion,
    categoriaId: idOpcional,
    precioVenta: monto,
    imagenUrl: z.preprocess(vacioAUndefined, z.url("URL inválida").optional()),
    activo: z.boolean().default(true),
    sabores: z.array(saborFormSchema).min(1, "Agregá al menos un sabor").max(200),
  })
  .superRefine((p, ctx) => {
    const variosSabores = p.sabores.length > 1;
    const nombres = new Map<string, number>();
    const codigos = new Map<string, number>();
    p.sabores.forEach((s, i) => {
      if (variosSabores && !s.sabor) {
        ctx.addIssue({
          code: "custom",
          message: "Poné el sabor",
          path: ["sabores", i, "sabor"],
        });
      }
      if (s.sabor) {
        const clave = s.sabor.toLocaleLowerCase("es");
        if (nombres.has(clave)) {
          ctx.addIssue({
            code: "custom",
            message: `Sabor repetido: ${s.sabor}`,
            path: ["sabores", i, "sabor"],
          });
        }
        nombres.set(clave, i);
      }
      if (s.codigoBarras) {
        const otra = codigos.get(s.codigoBarras);
        if (otra !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: `Código repetido (también en la fila ${otra + 1})`,
            path: ["sabores", i, "codigoBarras"],
          });
        }
        codigos.set(s.codigoBarras, i);
      }
    });
  })
  .transform((p) => ({
    ...p,
    sabores: p.sabores.map((s) => ({ ...s, nombre: s.sabor ?? NOMBRE_VARIANTE_UNICA })),
  }));

export const actualizarProductoSchema = z.object({ id, datos: productoSchema });

/**
 * Alta rápida desde el escáner: código desconocido → producto + sabor en un
 * paso. Si marca + modelo + especificación ya existen, solo se agrega el sabor
 * (y `precioVenta` no hace falta: el sabor usa el del producto salvo
 * `precioVentaSabor`).
 */
export const altaRapidaSchema = z.object({
  codigoBarras,
  marca: texto(80),
  modelo: texto(120),
  especificacion,
  sabor: textoOpcional(100),
  precioVenta: montoOpcional,
  precioVentaSabor: montoOpcional,
});

/** Carga de stock por escaneo. `depositoId` se valida en el servicio (mensaje propio). */
export const cargarStockSchema = z.object({
  depositoId: z.preprocess(vacioAUndefined, z.string().trim().optional()),
  items: z
    .array(z.object({ varianteId: id, cantidad }))
    .min(1, "No hay nada para cargar")
    .max(500, "Máximo 500 productos por carga"),
  motivo: textoOpcional(300),
});

export const codigoAlternativoSchema = z.object({
  varianteId: id,
  codigo: codigoBarras,
  descripcion: textoOpcional(200),
});

export const verificarCodigoSchema = z.object({
  codigo: codigoBarras,
  excluirVarianteId: idOpcional,
});

export const buscarVariantesSchema = z.object({
  q: z.string().trim().max(100),
  depositoId: idOpcional,
  soloConStockEnDeposito: z.boolean().optional(),
});

export const listarProductosSchema = z.object({
  q: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()),
  marcaId: idOpcional,
  soloBajoMinimo: z.preprocess((v) => v === true || v === "1" || v === "true", z.boolean()),
  inactivos: z.preprocess((v) => v === true || v === "1" || v === "true", z.boolean()),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(25),
});

export type ProductoInput = z.input<typeof productoSchema>;
export type Producto = z.output<typeof productoSchema>;
export type SaborForm = Producto["sabores"][number];
export type AltaRapida = z.output<typeof altaRapidaSchema>;
export type AltaRapidaInput = z.input<typeof altaRapidaSchema>;
export type CargarStock = z.output<typeof cargarStockSchema>;
export type FiltrosProductos = z.output<typeof listarProductosSchema>;
