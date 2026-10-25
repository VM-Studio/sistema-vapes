import { CondicionIva, EstadoFactura, TipoFactura } from "@prisma/client";
import { z } from "zod";

import {
  enteroPositivo,
  id,
  monto,
  montoOpcional,
  texto,
  textoOpcional,
  vacioAUndefined,
} from "./common";

/**
 * Facturas (puro: servidor y cliente). El sistema NO emite ante AFIP: registra
 * las facturas A/B/C que el negocio emite por fuera (con su número externo y,
 * si quiere, el PDF real) y genera comprobantes internos. Los importes los
 * calcula siempre el servidor (calcularImportesFactura).
 */

export const TIPO_FACTURA_LABEL: Record<TipoFactura, string> = {
  A: "Factura A",
  B: "Factura B",
  C: "Factura C",
  COMPROBANTE_INTERNO: "Comprobante interno",
};

export const TIPO_FACTURA_CORTO: Record<TipoFactura, string> = {
  A: "A",
  B: "B",
  C: "C",
  COMPROBANTE_INTERNO: "Interno",
};

export const CONDICION_IVA_LABEL: Record<CondicionIva, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable inscripto",
  MONOTRIBUTO: "Monotributo",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Consumidor final",
};

export const ESTADO_FACTURA_UI: Record<
  EstadoFactura,
  { label: string; variante: "success" | "neutral" }
> = {
  EMITIDA: { label: "Emitida", variante: "success" },
  ANULADA: { label: "Anulada", variante: "neutral" },
};

/** ID visible de una factura: COS-F-000001. */
export function formatearIdFactura(prefijo: string, numero: number): string {
  return `${prefijo}-F-${String(numero).padStart(6, "0")}`;
}

// --- CUIT ---------------------------------------------------------------------------

/** "20-12345678-6" / "20 12345678 6" → "20123456786" (solo dígitos). */
export const normalizarCuit = (cuit: string) => cuit.replace(/\D/g, "");

/**
 * CUIT/CUIL válido: 11 dígitos, prefijo de tipo conocido y dígito verificador
 * (módulo 11 con pesos 5-4-3-2-7-6-5-4-3-2; resto 1 → inválido salvo los
 * prefijos 23/33 que ya lo corrigen).
 */
export function cuitValido(cuit: string): boolean {
  const d = normalizarCuit(cuit);
  if (!/^\d{11}$/.test(d)) return false;
  if (!["20", "23", "24", "27", "30", "33", "34"].includes(d.slice(0, 2))) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((a, p, i) => a + p * Number(d[i]), 0);
  const resto = suma % 11;
  const verificador = resto === 0 ? 0 : resto === 1 ? -1 : 11 - resto;
  return verificador === Number(d[10]);
}

/** "20123456786" → "20-12345678-6". */
export function formatearCuit(cuit: string | null | undefined): string {
  const d = normalizarCuit(cuit ?? "");
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (cuit ?? "");
}

const cuitOpcional = z.preprocess(
  vacioAUndefined,
  z
    .string()
    .trim()
    .refine(cuitValido, "CUIT inválido (revisá los 11 dígitos)")
    .transform(normalizarCuit)
    .optional(),
);

// --- Importes -----------------------------------------------------------------------

export interface ImportesFactura {
  /** Σ ítems (precios finales). */
  bruto: string;
  descuento: string;
  /** Neto gravado en la A; igual al total en B, C e interno. */
  subtotal: string;
  alicuotaIva: string;
  iva: string;
  total: string;
}

const aCent = (m: number | string) => Math.round(Number(m) * 100);
const deCent = (c: number) => (c / 100).toFixed(2);

/**
 * Importes de una factura a partir de los ítems a precio FINAL (IVA incluido,
 * como se vende) y el descuento: total = Σ − descuento. En la A el IVA se
 * discrimina: neto = total / (1 + alícuota), IVA = total − neto (redondeado
 * al centavo, así neto + IVA = total exacto). En B (IVA incluido, no se
 * discrimina), C (monotributo) y el comprobante interno: subtotal = total.
 */
export function calcularImportesFactura(
  tipo: TipoFactura,
  items: readonly { cantidad: number; precioUnitario: number | string }[],
  descuento: number | string = 0,
  alicuotaIva: number | string = 21,
): ImportesFactura {
  const bruto = items.reduce((a, i) => a + aCent(i.precioUnitario) * i.cantidad, 0);
  const desc = Math.min(Math.max(aCent(descuento), 0), bruto);
  const total = bruto - desc;
  const discrimina = tipo === "A";
  const alicuota = discrimina ? Number(alicuotaIva) : 0;
  const neto = discrimina ? Math.round(total / (1 + alicuota / 100)) : total;
  return {
    bruto: deCent(bruto),
    descuento: deCent(desc),
    subtotal: deCent(neto),
    alicuotaIva: alicuota.toFixed(2),
    iva: deCent(total - neto),
    total: deCent(total),
  };
}

/**
 * Tipos que puede emitir el negocio según su condición frente al IVA: un
 * responsable inscripto emite A o B; un monotributista o exento, C. Sin
 * condición cargada, cualquiera (el negocio todavía no completó sus datos).
 */
export function tiposPermitidos(condicion: CondicionIva | null | undefined): TipoFactura[] {
  if (condicion === "RESPONSABLE_INSCRIPTO") return ["A", "B", "COMPROBANTE_INTERNO"];
  if (condicion === "MONOTRIBUTO" || condicion === "EXENTO") return ["C", "COMPROBANTE_INTERNO"];
  return ["A", "B", "C", "COMPROBANTE_INTERNO"];
}

// --- Esquemas -----------------------------------------------------------------------

/** Datos fiscales del cliente en la factura (la A exige razón social y CUIT). */
export const datosFiscalesSchema = z.object({
  razonSocial: textoOpcional(150),
  cuit: cuitOpcional,
  condicionIva: z.preprocess(vacioAUndefined, z.enum(CondicionIva).optional()),
  domicilio: textoOpcional(200),
});

const tipoFactura = z.enum(TipoFactura, { error: "Elegí el tipo de comprobante" });
const numeroExterno = z.preprocess(
  vacioAUndefined,
  z
    .string()
    .trim()
    .max(30, "Máximo 30 caracteres")
    .regex(/^[0-9A-Za-z-]+$/, "Solo números, letras y guiones (ej. 0001-00001234)")
    .optional(),
);

const exigirDatosA = <
  T extends { tipo: TipoFactura; datosFiscales: z.output<typeof datosFiscalesSchema> },
>(
  f: T,
  ctx: z.RefinementCtx,
) => {
  if (f.tipo !== "A") return;
  if (!f.datosFiscales.razonSocial)
    ctx.addIssue({
      code: "custom",
      message: "La factura A lleva la razón social",
      path: ["datosFiscales", "razonSocial"],
    });
  if (!f.datosFiscales.cuit)
    ctx.addIssue({
      code: "custom",
      message: "La factura A lleva el CUIT",
      path: ["datosFiscales", "cuit"],
    });
};

export const facturarVentaSchema = z
  .object({
    ventaId: id,
    tipo: tipoFactura,
    numeroExterno,
    datosFiscales: datosFiscalesSchema.prefault({}),
    observacion: textoOpcional(500),
  })
  .superRefine(exigirDatosA);

export const itemFacturaSchema = z.object({
  descripcion: texto(200),
  cantidad: enteroPositivo,
  precioUnitario: monto,
});

export const facturaSueltaSchema = z
  .object({
    clienteId: id,
    tipo: tipoFactura,
    numeroExterno,
    fecha: z.preprocess(
      vacioAUndefined,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
        .optional(),
    ),
    items: z.array(itemFacturaSchema).min(1, "Agregá al menos un renglón").max(100),
    descuento: montoOpcional,
    datosFiscales: datosFiscalesSchema.prefault({}),
    observacion: textoOpcional(500),
  })
  .superRefine(exigirDatosA);

export const anularFacturaSchema = z.object({
  id,
  motivo: texto(500).refine((m) => m.length >= 3, "Contá brevemente por qué se anula"),
});

export const numeroExternoSchema = z.object({ id, numeroExterno });

const fechaFiltro = z
  .preprocess(
    vacioAUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  )
  .catch(undefined);

export const listarFacturasSchema = z.object({
  desde: fechaFiltro,
  hasta: fechaFiltro,
  tipo: z.preprocess(vacioAUndefined, z.enum(TipoFactura).optional()).catch(undefined),
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoFactura).optional()).catch(undefined),
  /** Código (COS-F-000012), número externo, venta o cliente. */
  q: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()).catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(30),
});

// --- Configuración del panel (clave "facturacion") ----------------------------------

export const configFacturacionSchema = z.object({
  habilitada: z.boolean().default(false),
  razonSocial: textoOpcional(150),
  cuit: cuitOpcional,
  condicionIva: z.preprocess(vacioAUndefined, z.enum(CondicionIva).optional()),
  domicilio: textoOpcional(200),
  puntoVenta: z.coerce
    .number()
    .int("Número entero")
    .min(1, "Mínimo 1")
    .max(99999, "Máximo 99999")
    .default(1),
  /** Alícuota de IVA de la factura A (precios con IVA incluido). */
  alicuotaIva: z.coerce
    .number()
    .refine((n) => [0, 10.5, 21, 27].includes(n), "Elegí 0, 10,5, 21 o 27")
    .default(21),
});

export type ConfigFacturacion = z.output<typeof configFacturacionSchema>;
export type ConfigFacturacionInput = z.input<typeof configFacturacionSchema>;
export type DatosFiscales = z.output<typeof datosFiscalesSchema>;
export type FacturarVenta = z.output<typeof facturarVentaSchema>;
export type FacturaSuelta = z.output<typeof facturaSueltaSchema>;
export type FiltrosFacturas = z.output<typeof listarFacturasSchema>;

// --- Facturas de ventas Mercado Libre (cargadas en ARCA, por fuera) ---------------

export const ESTADOS_FACTURA_ML = ["PENDIENTE", "CARGADA"] as const;
export type EstadoFacturaML = (typeof ESTADOS_FACTURA_ML)[number];

export const ESTADO_FACTURA_ML_UI: Record<
  EstadoFacturaML,
  { label: string; variante: "warning" | "success" }
> = {
  PENDIENTE: { label: "Pendiente", variante: "warning" },
  CARGADA: { label: "Cargada", variante: "success" },
};

/** Archivo de la factura ML: PDF o imagen, hasta 5 MB (límite de las Server Actions: 6 MB). */
export const TIPOS_ARCHIVO_FACTURA_ML = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const MAX_ARCHIVO_FACTURA_ML = 5 * 1024 * 1024;

/** Filtros de Facturas → Ventas Mercado Libre (período de la VENTA y estado de la factura). */
export const listarVentasMLSchema = z.object({
  desde: fechaFiltro,
  hasta: fechaFiltro,
  estado: z.preprocess(vacioAUndefined, z.enum(ESTADOS_FACTURA_ML).optional()).catch(undefined),
  /** ID de venta (COS-000123 o 123) o cliente. */
  q: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()).catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(30),
});

/** «Cargado»: la fecha de la factura (default hoy) y, opcional, su archivo (aparte, FormData). */
export const cargarFacturaMLSchema = z.object({
  ventaId: id,
  fecha: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
});

export type FiltrosVentasML = z.output<typeof listarVentasMLSchema>;
export type CargarFacturaML = z.output<typeof cargarFacturaMLSchema>;
