/**
 * Precios del catálogo (puro: servidor y cliente).
 *
 * - Precio de venta: el del producto para todos sus sabores; un sabor puede
 *   tener precio propio (Variante.precioVenta, null = usa el del producto).
 * - Costo: Variante.ultimoCosto = costo de la última compra recibida. Cada
 *   venta guarda un SNAPSHOT de ese costo en VentaItem.costoUnitario (0 si el
 *   sabor todavía no tiene compras): la ganancia de una venta no cambia
 *   aunque después cambie el costo.
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

/** ¿El sabor tiene un precio distinto al del producto? */
export function tienePrecioPropio(variante: { precioVenta: Monto }): boolean {
  return variante.precioVenta !== null && variante.precioVenta !== undefined;
}

/** Costo que se congela en la venta: el último costo, o 0 si todavía no hubo compras. */
export function costoParaVenta(variante: { ultimoCosto: Monto }): string {
  return aTexto(variante.ultimoCosto) ?? "0.00";
}
