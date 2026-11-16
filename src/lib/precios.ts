/**
 * Precios del catálogo (puro: servidor y cliente).
 *
 * - Precio de venta: el del producto para todos sus sabores; un sabor puede
 *   tener precio propio (Variante.precioVenta, null = usa el del producto).
 * - Costo: Variante.ultimoCostoUsdt = costo en USDT (última compra recibida o
 *   el tipeado al cargar stock). Cada venta guarda un SNAPSHOT de ese costo en
 *   VentaItem.costoUnitarioUsdt (0 si el sabor no tiene costo): la ganancia de
 *   una venta no cambia aunque después cambie el costo o la cotización.
 */
type Monto = { toString(): string } | string | number | null | undefined;

const aTexto = (m: Monto): string | null =>
  m === null || m === undefined ? null : typeof m === "number" ? m.toFixed(2) : m.toString();

/** Precio de venta efectivo de un sabor: el propio o, si no tiene, el del producto. */
export function precioVentaEfectivo(
  variante: { precioVenta: Monto },
  producto: { precioVenta: Monto },
): string {
  return aTexto(variante.precioVenta) ?? aTexto(producto.precioVenta) ?? "0.00";
}

/**
 * Precio Mercado Libre efectivo de un sabor: el propio o el del producto; null
 * si ninguno lo tiene (en una venta por Mercado Libre queda a precio de lista).
 */
export function precioVentaMLEfectivo(
  variante: { precioVentaML?: Monto },
  producto: { precioVentaML?: Monto },
): string | null {
  return aTexto(variante.precioVentaML) ?? aTexto(producto.precioVentaML);
}

/** ¿El sabor tiene un precio distinto al del producto? */
export function tienePrecioPropio(variante: { precioVenta: Monto }): boolean {
  return variante.precioVenta !== null && variante.precioVenta !== undefined;
}

/** Costo en USDT que se congela en la venta: el último costo, o 0 si no tiene. */
export function costoParaVenta(variante: { ultimoCostoUsdt: Monto }): string {
  return aTexto(variante.ultimoCostoUsdt) ?? "0.00";
}
