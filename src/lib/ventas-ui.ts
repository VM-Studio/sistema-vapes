import type { EstadoVenta, MedioPago, TipoVenta } from "@prisma/client";

import { formatearPesos } from "./format";

export const ESTADO_VENTA_UI: Record<
  EstadoVenta,
  { label: string; variante: "success" | "neutral" }
> = {
  CONFIRMADA: { label: "Confirmada", variante: "success" },
  ANULADA: { label: "Anulada", variante: "neutral" },
};

/** Orden en que el modal ofrece los medios (el más usado primero). */
export const MEDIOS_PAGO: readonly MedioPago[] = ["EFECTIVO", "TRANSFERENCIA", "BINANCE"];

export const ETIQUETA_MEDIO_PAGO: Record<MedioPago, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  BINANCE: "Binance",
};

/** Badge del medio de pago: Efectivo verde, Transferencia azul, Binance amarillo. */
export const CLASE_MEDIO_PAGO: Record<MedioPago, string> = {
  EFECTIVO: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 ring-inset",
  TRANSFERENCIA: "bg-blue-50 text-blue-700 ring-1 ring-blue-200 ring-inset",
  BINANCE: "bg-amber-100 text-amber-800 ring-1 ring-amber-300 ring-inset",
};

export const ETIQUETA_TIPO_VENTA: Record<TipoVenta, string> = {
  UNITARIA: "Unitaria",
  MAYORISTA: "Mayorista",
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

/** Teléfono normalizado ("+541155551234") → lo que espera wa.me ("541155551234"). */
export const telefonoWhatsApp = (telefono: string) => telefono.replace(/\D/g, "");

/** Resumen de la venta para mandarle al cliente por WhatsApp. */
export function textoResumenVenta(v: {
  codigo: string;
  cliente: string;
  items: { titulo: string; cantidad: number; subtotal: string }[];
  descuento: string;
  total: string;
}): string {
  const lineas = [
    `¡Hola ${v.cliente}! Gracias por tu compra.`,
    `Venta ${v.codigo}`,
    "",
    ...v.items.map((i) => `• ${i.cantidad} × ${i.titulo}: ${formatearPesos(i.subtotal)}`),
    ...(Number(v.descuento) > 0 ? [`Descuento: −${formatearPesos(v.descuento)}`] : []),
    `Total: ${formatearPesos(v.total)}`,
  ];
  return lineas.join("\n");
}

/** Link de WhatsApp con el resumen: https://wa.me/{teléfono sin +}?text=… */
export function linkWhatsAppVenta(telefono: string, texto: string): string {
  return `https://wa.me/${telefonoWhatsApp(telefono)}?text=${encodeURIComponent(texto)}`;
}

/** "+541155551234" → "+54 11 5555 1234" (solo para mostrar). */
export function telefonoVisible(telefono: string): string {
  const d = telefono.replace(/^\+54/, "");
  if (d.length === 10) return `+54 ${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("9"))
    return `+54 9 ${d.slice(1, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  return telefono;
}
