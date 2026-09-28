import type { EstadoVenta, MedioPago } from "@prisma/client";

export const ESTADO_VENTA_UI: Record<
  EstadoVenta,
  { label: string; variante: "warning" | "success" | "neutral" }
> = {
  BORRADOR: { label: "Borrador", variante: "warning" },
  CONFIRMADA: { label: "Confirmada", variante: "success" },
  ANULADA: { label: "Anulada", variante: "neutral" },
};

/** Orden en que el POS ofrece los medios (el más usado primero). */
export const MEDIOS_PAGO: readonly MedioPago[] = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "MERCADOPAGO",
  "DEBITO",
  "CREDITO",
  "OTRO",
];

export const ETIQUETA_MEDIO_PAGO: Record<MedioPago, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  DEBITO: "Débito",
  CREDITO: "Crédito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
};
