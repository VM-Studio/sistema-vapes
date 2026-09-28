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
};

/** Etiqueta y color del badge de cada estado. */
export const ESTADO_COTIZACION_UI = Object.fromEntries(
  Object.entries(ETIQUETAS).map(([e, { label }]) => [
    e,
    { label, variante: VARIANTE[e as EstadoCotizacion] },
  ]),
) as Record<EstadoCotizacion, { label: string; variante: Variante }>;

/** Se puede editar (y volver a guardar) mientras no esté cerrada. */
export const esEditable = (estado: EstadoCotizacion) =>
  estado === "BORRADOR" || estado === "ENVIADA";

/** Se puede convertir en venta (VENCIDA pide confirmar los precios de hoy). */
export const esConvertible = (estado: EstadoCotizacion) =>
  estado === "BORRADOR" || estado === "ENVIADA" || estado === "ACEPTADA" || estado === "VENCIDA";
