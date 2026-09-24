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

export const emailOpcional = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => (v === "" ? undefined : v))
  .pipe(z.email("Email inválido").optional());

/**
 * Monto de dinero: acepta number o string ("1500.5"), >= 0, máximo 2 decimales.
 * Sale como number redondeado a centavos; los servicios lo pasan a Decimal.
 */
export const monto = z.coerce
  .number({ error: "Monto inválido" })
  .finite("Monto inválido")
  .nonnegative("El monto no puede ser negativo")
  .max(MONTO_MAXIMO, "Monto demasiado grande")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Máximo 2 decimales")
  .transform((v) => Math.round(v * 100) / 100);

export const montoPositivo = monto.refine((v) => v > 0, "El monto debe ser mayor a 0");

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

/** Valida CUIT/CUIL argentino (11 dígitos + dígito verificador módulo 11). Acepta guiones. */
export function esCuitValido(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(cuit[i]), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return verificador === Number(cuit[10]);
}

export const cuitOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/[-\s]/g, "") : undefined))
  .refine((v) => v === undefined || esCuitValido(v), "CUIT inválido");

/** Ids únicos dentro de una lista de ítems (ej: misma variante dos veces en una venta). */
export function sinDuplicados<T>(items: T[], clave: (item: T) => string): boolean {
  return new Set(items.map(clave)).size === items.length;
}
