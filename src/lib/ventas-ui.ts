import type { EstadoPago, EstadoVenta } from "@prisma/client";

export const ESTADO_VENTA_UI: Record<
  EstadoVenta,
  { label: string; variante: "warning" | "success" | "neutral" }
> = {
  BORRADOR: { label: "Borrador", variante: "warning" },
  CONFIRMADA: { label: "Confirmada", variante: "success" },
  ANULADA: { label: "Anulada", variante: "neutral" },
};

export const ESTADO_PAGO_UI: Record<
  EstadoPago,
  { label: string; variante: "success" | "warning" | "danger" }
> = {
  PAGADA: { label: "Pagada", variante: "success" },
  PARCIAL: { label: "Pago parcial", variante: "warning" },
  PENDIENTE: { label: "Pendiente", variante: "danger" },
};
