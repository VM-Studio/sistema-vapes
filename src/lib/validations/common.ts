import { z } from "zod";

import { CODIGO_BARRAS_REGEX, normalizarCodigoBarras } from "@/lib/barcode";

/** Máximo representable en Decimal(12,2). */
export const MONTO_MAXIMO = 9_999_999_999.99;

export const id = z.string().trim().min(1, "Id requerido");

/** String obligatorio, con trim. */
export const texto = (max = 200) =>
  z.string().trim().min(1, "Campo requerido").max(max, `Máximo ${max} caracteres`);

/** String opcional: "" (o solo espacios) se normaliza a undefined. */
export const textoOpcional = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const email = z.string().trim().toLowerCase().pipe(z.email("Email inválido"));

/** Un campo de formulario vacío ("" o espacios) es "sin valor", nunca 0. */
export const vacioAUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const montoBase = z.coerce
  .number({ error: (iss) => (iss.input === undefined ? "Ingresá un monto" : "Monto inválido") })
  .finite("Monto inválido")
  .nonnegative("El monto no puede ser negativo")
  .max(MONTO_MAXIMO, "Monto demasiado grande")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Máximo 2 decimales")
  .transform((v) => Math.round(v * 100) / 100);

/**
 * Monto de dinero obligatorio: acepta number o string ("1500.5"), >= 0,
 * máximo 2 decimales. "" es error (z.coerce solo lo convertiría en 0: un
 * precio sin cargar no puede transformarse en una venta a $0).
 * Sale como number redondeado a centavos; los servicios lo pasan a Decimal.
 */
export const monto = z.preprocess(vacioAUndefined, montoBase);

/** Monto opcional: vacío/ausente => undefined. */
export const montoOpcional = z.preprocess(vacioAUndefined, montoBase.optional());

/** Monto con default 0 (descuentos): vacío/ausente => 0. */
export const montoOCero = z.preprocess(vacioAUndefined, montoBase.default(0));

export const montoPositivo = monto.refine((v) => v > 0, "El monto debe ser mayor a 0");

/**
 * Enteros desde inputs de formulario ("12" -> 12). Vacío es error, no 0.
 * Para datos que ya vienen como number usar `cantidad`.
 */
export const enteroPositivo = z.preprocess(
  vacioAUndefined,
  z.coerce
    .number({
      error: (iss) => (iss.input === undefined ? "Ingresá una cantidad" : "Cantidad inválida"),
    })
    .int("Tiene que ser un número entero")
    .positive("Tiene que ser mayor a 0")
    .max(1_000_000, "Cantidad demasiado grande"),
);

export const enteroNoNegativo = z.preprocess(
  vacioAUndefined,
  z.coerce
    .number({ error: (iss) => (iss.input === undefined ? "Ingresá un número" : "Número inválido") })
    .int("Tiene que ser un número entero")
    .nonnegative("No puede ser negativo")
    .max(1_000_000, "Número demasiado grande"),
);

/** Cantidades: siempre enteros positivos. */
export const cantidad = z
  .number({ error: "Cantidad inválida" })
  .int("La cantidad debe ser un número entero")
  .positive("La cantidad debe ser mayor a 0")
  .max(1_000_000, "Cantidad demasiado grande");

export const codigoBarras = z
  .string()
  .trim()
  .transform(normalizarCodigoBarras)
  .pipe(
    z
      .string()
      .regex(CODIGO_BARRAS_REGEX, "Código de barras inválido (4-64 letras, números o guiones)"),
  );

export const codigoBarrasOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? normalizarCodigoBarras(v) : undefined))
  .pipe(codigoBarras.optional());

/** Ids únicos dentro de una lista de ítems (ej: misma variante dos veces en una venta). */
export function sinDuplicados<T>(items: T[], clave: (item: T) => string): boolean {
  return new Set(items.map(clave)).size === items.length;
}
