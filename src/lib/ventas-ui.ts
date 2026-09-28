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

/** Nombre de la variante de un producto sin sabor (la UI no lo muestra como sabor). */
export const SABOR_UNICO = "Único";

/** El sabor para mostrar: null si es la variante "Único" de un producto sin sabor. */
export function saborVisible(sabor: string | null | undefined): string | null {
  return !sabor || sabor.trim() === "" || sabor === SABOR_UNICO ? null : sabor;
}

/** "Elf Bar BC 5000 — Mango Ice", o solo el nombre completo del producto si no tiene sabor. */
export function nombreConSabor(nombreCompleto: string, sabor: string | null | undefined): string {
  const s = saborVisible(sabor);
  return s ? `${nombreCompleto} — ${s}` : nombreCompleto;
}
