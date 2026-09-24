import { TipoMovimiento } from "@prisma/client";

/** Cómo se muestra cada tipo de movimiento (badge + color por familia). */
export const TIPO_MOVIMIENTO_UI: Record<
  TipoMovimiento,
  { label: string; variante: "success" | "danger" | "primary" | "warning" | "neutral" }
> = {
  INGRESO_COMPRA: { label: "Ingreso por compra", variante: "success" },
  INGRESO_MANUAL: { label: "Ingreso manual", variante: "success" },
  DEVOLUCION_CLIENTE: { label: "Devolución de cliente", variante: "success" },
  VENTA: { label: "Venta", variante: "danger" },
  DEVOLUCION_PROVEEDOR: { label: "Devolución a proveedor", variante: "danger" },
  TRANSFERENCIA_SALIDA: { label: "Transferencia (salida)", variante: "primary" },
  TRANSFERENCIA_ENTRADA: { label: "Transferencia (entrada)", variante: "primary" },
  AJUSTE_POSITIVO: { label: "Ajuste +", variante: "warning" },
  AJUSTE_NEGATIVO: { label: "Ajuste −", variante: "warning" },
};

export const ESTADO_STOCK_UI = {
  OK: { label: "OK", variante: "success" },
  BAJO: { label: "Bajo mínimo", variante: "warning" },
  SIN_STOCK: { label: "Sin stock", variante: "danger" },
} as const;

export const ESTADO_TRANSFERENCIA_UI = {
  PENDIENTE: { label: "Pendiente", variante: "warning" },
  COMPLETADA: { label: "Completada", variante: "success" },
  ANULADA: { label: "Anulada", variante: "neutral" },
} as const;
