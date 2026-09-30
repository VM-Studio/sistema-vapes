import { EstadoCotizacion, TipoCotizacion } from "@prisma/client";
import { z } from "zod";

import { prefijoPanel } from "@/lib/paneles";

import { enteroPositivo, id, montoOpcional, texto, textoOpcional, vacioAUndefined } from "./common";
import { pagosSchema } from "./venta";

/**
 * Cotizador (unitario y mayorista). El cliente manda sabores y cantidades:
 * precios de lista, escalones y totales los calcula SIEMPRE el servidor
 * (precio.service). Un precio manual por ítem y el descuento global requieren
 * "editar" en COTIZADOR (lo valida el servicio).
 */

/** ID visible de una cotización: VAP-Q-000001. */
export function formatearIdCotizacion(slug: string, numero: number): string {
  return `${prefijoPanel(slug)}-Q-${String(numero).padStart(6, "0")}`;
}

// --- Configuración del panel (clave "cotizacion") ------------------------------

export const MODOS_ESCALON = ["POR_PRODUCTO", "POR_TOTAL"] as const;
export type ModoEscalon = (typeof MODOS_ESCALON)[number];

export const LEYENDA_COTIZACION_DEFAULT =
  "Precios sujetos a disponibilidad de stock. No incluye envío.";

export const configCotizacionSchema = z.object({
  validezDias: z.coerce
    .number({ error: "Ingresá los días de validez" })
    .int("Tiene que ser un número entero")
    .min(1, "Mínimo 1 día")
    .max(365, "Máximo 365 días")
    .default(7),
  /**
   * POR_PRODUCTO: las unidades de cada producto (todos sus sabores) definen su escalón.
   * POR_TOTAL: las unidades de toda la cotización definen el escalón de todos los productos.
   */
  modoEscalonMayorista: z.enum(MODOS_ESCALON).default("POR_PRODUCTO"),
  leyenda: z.string().trim().max(500, "Máximo 500 caracteres").default(LEYENDA_COTIZACION_DEFAULT),
  mostrarStock: z.boolean().default(true),
});

export type ConfigCotizacion = z.output<typeof configCotizacionSchema>;
export type ConfigCotizacionInput = z.input<typeof configCotizacionSchema>;

// --- Escalones -------------------------------------------------------------------

const porcentaje = z.preprocess(
  vacioAUndefined,
  z.coerce
    .number({ error: (iss) => (iss.input === undefined ? "Ingresá el %" : "Porcentaje inválido") })
    .min(0, "No puede ser negativo")
    .max(100, "Máximo 100 %")
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Máximo 2 decimales"),
);

export const escalonSchema = z.object({
  cantidadMinima: enteroPositivo,
  precioUnitario: z.preprocess(
    vacioAUndefined,
    z.coerce
      .number({ error: "Ingresá el precio" })
      .positive("El precio tiene que ser mayor a 0")
      .max(9_999_999_999.99, "Precio demasiado grande"),
  ),
  activo: z.boolean().default(true),
});

export const escalonDefaultSchema = z.object({
  cantidadMinima: enteroPositivo,
  porcentajeDescuento: porcentaje,
  activo: z.boolean().default(true),
});

export const guardarEscalonesSchema = z.object({
  productoId: id,
  escalones: z.array(escalonSchema).max(20, "Máximo 20 escalones"),
});

export const guardarEscalonesDefaultSchema = z.object({
  escalones: z.array(escalonDefaultSchema).max(20, "Máximo 20 escalones"),
});

export type EscalonInput = z.output<typeof escalonSchema>;
export type EscalonDefaultInput = z.output<typeof escalonDefaultSchema>;

// --- Cotización ------------------------------------------------------------------

export const tipoCotizacionSchema = z.enum(TipoCotizacion, { error: "Elegí el tipo" });

export const itemCotizacionSchema = z.object({
  varianteId: id,
  cantidad: enteroPositivo,
  /** Precio por unidad a mano (pisa lista y escalones; requiere "editar"). */
  precioManual: montoOpcional,
});

export const clienteCotizacionSchema = z
  .union([
    z.object({ id }),
    z.object({
      nombre: texto(100),
      telefono: z.string().trim().min(1, "Ingresá el teléfono").max(40, "Máximo 40 caracteres"),
    }),
  ])
  .nullable();

export const calcularPreciosSchema = z.object({
  tipo: tipoCotizacionSchema,
  items: z.array(itemCotizacionSchema).max(300, "Máximo 300 productos"),
});

export const crearCotizacionSchema = z.object({
  tipo: tipoCotizacionSchema,
  items: z
    .array(itemCotizacionSchema)
    .min(1, "Agregá al menos un producto")
    .max(300, "Máximo 300 productos por cotización"),
  cliente: clienteCotizacionSchema.default(null),
  /** Descuento global en pesos (requiere "editar"). */
  descuento: montoOpcional,
  notas: textoOpcional(2000),
  validezDias: z.preprocess(
    vacioAUndefined,
    z.coerce.number().int().min(1, "Mínimo 1 día").max(365, "Máximo 365 días").optional(),
  ),
});

export const rechazarCotizacionSchema = z.object({
  id,
  motivo: textoOpcional(500),
});

export const convertirCotizacionSchema = z.object({
  id,
  depositoId: id,
  /** Pagos de la venta (mismas reglas que Generar venta). */
  pagos: pagosSchema,
  fiar: z.boolean().default(false),
  clienteId: z.preprocess(vacioAUndefined, id.optional()),
  /** Solo para cotizaciones vencidas: usar los precios de hoy en vez de los cotizados. */
  recalcular: z.boolean().optional(),
});

const fechaISO = z
  .preprocess(
    vacioAUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  )
  .catch(undefined);

const idFiltro = z.preprocess(vacioAUndefined, id.optional()).catch(undefined);

export const listarCotizacionesSchema = z.object({
  tipo: z.preprocess(vacioAUndefined, z.enum(TipoCotizacion).optional()).catch(undefined),
  estado: z.preprocess(vacioAUndefined, z.enum(EstadoCotizacion).optional()).catch(undefined),
  vendedorId: idFiltro,
  clienteId: idFiltro,
  desde: fechaISO,
  hasta: fechaISO,
  /** Código (VAP-Q-000012 o 12), nombre o teléfono del cliente. */
  q: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()).catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(30),
});

export const resumenCotizacionesSchema = z.object({
  desde: fechaISO,
  hasta: fechaISO,
  vendedorId: idFiltro,
});

export type ItemCotizacion = z.output<typeof itemCotizacionSchema>;
export type ClienteCotizacion = z.output<typeof clienteCotizacionSchema>;
export type CalcularPrecios = z.output<typeof calcularPreciosSchema>;
export type CrearCotizacion = z.output<typeof crearCotizacionSchema>;
export type CrearCotizacionInput = z.input<typeof crearCotizacionSchema>;
export type ConvertirCotizacion = z.output<typeof convertirCotizacionSchema>;
export type FiltrosCotizaciones = z.output<typeof listarCotizacionesSchema>;
export type FiltrosResumenCotizaciones = z.output<typeof resumenCotizacionesSchema>;

export const ESTADO_COTIZACION_UI: Record<EstadoCotizacion, { label: string }> = {
  BORRADOR: { label: "Borrador" },
  ENVIADA: { label: "Enviada" },
  ACEPTADA: { label: "Aceptada" },
  RECHAZADA: { label: "Rechazada" },
  VENCIDA: { label: "Vencida" },
  CONVERTIDA: { label: "Convertida en venta" },
};

export const ETIQUETA_TIPO_COTIZACION: Record<TipoCotizacion, string> = {
  UNITARIA: "Unitaria",
  MAYORISTA: "Mayorista",
};
