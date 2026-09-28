import type { EstadoDevolucion, EstadoVenta, MedioPago } from "@prisma/client";

type VarianteBadge = "success" | "neutral" | "warning";

export const ESTADO_VENTA_CLIENTE: Record<EstadoVenta, { label: string; variante: VarianteBadge }> =
  {
    CONFIRMADA: { label: "Confirmada", variante: "success" },
    ANULADA: { label: "Anulada", variante: "neutral" },
  };

export const ESTADO_DEVOLUCION_UI: Record<
  EstadoDevolucion,
  { label: string; variante: VarianteBadge }
> = {
  REGISTRADA: { label: "Registrada", variante: "success" },
  ANULADA: { label: "Anulada", variante: "neutral" },
};

export const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  BINANCE: "Binance",
};
