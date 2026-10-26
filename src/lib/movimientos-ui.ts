import { TipoMovimiento } from "@prisma/client";

type VarianteBadge = "success" | "danger" | "primary" | "warning" | "neutral";

/**
 * Cómo se muestra cada tipo de movimiento (badge + color por familia) y su
 * signo (+1 entra, −1 sale). El signo es espejo de signoMovimiento() del
 * motor y de fn_signo_movimiento() en SQL (los tests verifican que coincidan).
 */
export const TIPO_MOVIMIENTO_UI: Record<
  TipoMovimiento,
  { label: string; variante: VarianteBadge; signo: 1 | -1 }
> = {
  INGRESO_COMPRA: { label: "Ingreso por compra", variante: "success", signo: 1 },
  INGRESO_MANUAL: { label: "Ingreso manual", variante: "success", signo: 1 },
  DEVOLUCION_CLIENTE: { label: "Devolución de cliente", variante: "success", signo: 1 },
  VENTA: { label: "Venta", variante: "danger", signo: -1 },
  VENTA_ANULADA: { label: "Venta anulada", variante: "success", signo: 1 },
  GARANTIA: { label: "Garantía", variante: "danger", signo: -1 },
  GARANTIA_ANULADA: { label: "Garantía anulada", variante: "success", signo: 1 },
  DEVOLUCION_PROVEEDOR: { label: "Devolución a proveedor", variante: "danger", signo: -1 },
  TRANSFERENCIA_SALIDA: { label: "Transferencia (salida)", variante: "primary", signo: -1 },
  TRANSFERENCIA_ENTRADA: { label: "Transferencia (entrada)", variante: "primary", signo: 1 },
  AJUSTE_POSITIVO: { label: "Ajuste +", variante: "warning", signo: 1 },
  AJUSTE_NEGATIVO: { label: "Ajuste −", variante: "warning", signo: -1 },
};

/**
 * Tipos para filtrar el ledger (DEVOLUCION_CLIENTE solo existe en movimientos
 * anteriores a la reforma R3: no se ofrece como filtro).
 */
export const TIPOS_MOVIMIENTO_FILTRO: readonly TipoMovimiento[] = Object.values(
  TipoMovimiento,
).filter((t) => t !== TipoMovimiento.DEVOLUCION_CLIENTE);

/**
 * Familias para filtrar el ledger de forma simple. «Retiros» no son
 * movimientos (no cambian cantidad): son el momento en que el cliente se llevó
 * lo vendido, y se listan como eventos informativos.
 */
export const FAMILIAS_MOVIMIENTO = {
  entradas: {
    label: "Entradas",
    tipos: (Object.keys(TIPO_MOVIMIENTO_UI) as TipoMovimiento[]).filter(
      (t) => TIPO_MOVIMIENTO_UI[t].signo === 1,
    ),
    retiros: false,
  },
  salidas: {
    label: "Salidas",
    tipos: (Object.keys(TIPO_MOVIMIENTO_UI) as TipoMovimiento[]).filter(
      (t) => TIPO_MOVIMIENTO_UI[t].signo === -1,
    ),
    retiros: false,
  },
  ventas: {
    label: "Ventas (y retiros)",
    tipos: [TipoMovimiento.VENTA, TipoMovimiento.VENTA_ANULADA],
    retiros: true,
  },
  retiros: { label: "Retiros", tipos: [], retiros: true },
  compras: {
    label: "Compras",
    tipos: [TipoMovimiento.INGRESO_COMPRA, TipoMovimiento.DEVOLUCION_PROVEEDOR],
    retiros: false,
  },
  ajustes: {
    label: "Ajustes e ingresos manuales",
    tipos: [
      TipoMovimiento.AJUSTE_POSITIVO,
      TipoMovimiento.AJUSTE_NEGATIVO,
      TipoMovimiento.INGRESO_MANUAL,
    ],
    retiros: false,
  },
  transferencias: {
    label: "Transferencias",
    tipos: [TipoMovimiento.TRANSFERENCIA_SALIDA, TipoMovimiento.TRANSFERENCIA_ENTRADA],
    retiros: false,
  },
  devoluciones: {
    label: "Devoluciones y garantías",
    tipos: [
      TipoMovimiento.GARANTIA,
      TipoMovimiento.GARANTIA_ANULADA,
      TipoMovimiento.DEVOLUCION_CLIENTE,
    ],
    retiros: false,
  },
} as const satisfies Record<
  string,
  { label: string; tipos: readonly TipoMovimiento[]; retiros: boolean }
>;

export type FamiliaMovimiento = keyof typeof FAMILIAS_MOVIMIENTO;
export const FAMILIAS: readonly FamiliaMovimiento[] = Object.keys(
  FAMILIAS_MOVIMIENTO,
) as FamiliaMovimiento[];

export const ESTADO_STOCK_UI = {
  OK: { label: "OK", variante: "success" },
  BAJO: { label: "Bajo mínimo", variante: "warning" },
  SIN_STOCK: { label: "Sin stock", variante: "danger" },
} as const;

export type EstadoStockUI = keyof typeof ESTADO_STOCK_UI;

/** Estado de una cantidad contra el mínimo del sabor. */
export function estadoDeStock(cantidad: number, minimo: number): EstadoStockUI {
  if (cantidad <= 0) return "SIN_STOCK";
  if (cantidad < minimo) return "BAJO";
  return "OK";
}

export const ESTADO_TRANSFERENCIA_UI = {
  PENDIENTE: { label: "Pendiente", variante: "warning" },
  COMPLETADA: { label: "Completada", variante: "success" },
  ANULADA: { label: "Anulada", variante: "neutral" },
} as const;

export const ESTADO_COMPRA_UI = {
  BORRADOR: { label: "Borrador", variante: "warning" },
  RECIBIDA: { label: "Recibida", variante: "success" },
  ANULADA: { label: "Anulada", variante: "neutral" },
} as const;

/** Link de WhatsApp sin destinatario (el usuario elige el chat): remito de una transferencia. */
export function linkWhatsAppTexto(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}
