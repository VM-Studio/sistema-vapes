import type { EstadoCotizacion } from "@prisma/client";

import { ESTADO_COTIZACION_UI as ETIQUETAS } from "@/lib/validations/cotizacion";

export { ETIQUETA_TIPO_COTIZACION } from "@/lib/validations/cotizacion";

type Variante = "neutral" | "primary" | "success" | "warning" | "danger";

const VARIANTE: Record<EstadoCotizacion, Variante> = {
  BORRADOR: "neutral",
  ENVIADA: "primary",
  ACEPTADA: "success",
  RECHAZADA: "danger",
  VENCIDA: "warning",
  CONVERTIDA: "success",
  ANULADA: "neutral",
};

/** Etiqueta y color del badge de cada estado. */
export const ESTADO_COTIZACION_UI = Object.fromEntries(
  Object.entries(ETIQUETAS).map(([e, { label }]) => [
    e,
    { label, variante: VARIANTE[e as EstadoCotizacion] },
  ]),
) as Record<EstadoCotizacion, { label: string; variante: Variante }>;

/**
 * Se puede editar (y volver a guardar) mientras no esté cerrada: los mismos
 * estados que acepta el servicio (una vencida vuelve a borrador con precios de hoy).
 */
export const esEditable = (estado: EstadoCotizacion) =>
  estado === "BORRADOR" || estado === "ENVIADA" || estado === "ACEPTADA" || estado === "VENCIDA";

/** Se puede anular mientras no se haya convertido en venta (ni esté ya anulada). */
export const esAnulable = (estado: EstadoCotizacion) =>
  estado !== "CONVERTIDA" && estado !== "ANULADA";

/** Se puede convertir en venta (VENCIDA pide confirmar los precios de hoy). */
export const esConvertible = (estado: EstadoCotizacion) =>
  estado === "BORRADOR" || estado === "ENVIADA" || estado === "ACEPTADA" || estado === "VENCIDA";

/**
 * «Aceptada ✓» desde la lista (venta pendiente de pago): solo vigentes, sin
 * convertir ni rechazar. Una vencida pide revisar los precios de hoy.
 */
export const esAceptable = (estado: EstadoCotizacion) =>
  estado === "BORRADOR" || estado === "ENVIADA" || estado === "ACEPTADA";
