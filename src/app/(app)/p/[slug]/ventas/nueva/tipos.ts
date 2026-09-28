/** Una fila del carrito del POS. Los precios son informativos: el total real lo calcula el servidor. */
export interface ItemCarrito {
  varianteId: string;
  nombreCompleto: string;
  sku: string;
  /** Precio de lista (precioVenta) al momento de agregarlo; se refresca antes de cobrar. */
  precioLista: string;
  /** Precio manual (solo con permiso "editar"); null = el de lista. */
  precioManual: string | null;
  cantidad: number;
  /** Stock en el depósito elegido. */
  stock: number;
}

export interface DescuentoGlobal {
  tipo: "monto" | "porcentaje";
  valor: string;
}

export const num = (s: string | number | null | undefined) => {
  const n = typeof s === "number" ? s : Number(String(s ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Centavos enteros para no acumular errores de punto flotante. */
export const centavos = (n: number) => Math.round(n * 100);

export function precioDe(i: ItemCarrito): number {
  return num(i.precioManual ?? i.precioLista);
}

/** Espejo del cálculo del servidor (solo para mostrar). */
export function calcularTotales(
  items: ItemCarrito[],
  descuento: DescuentoGlobal | null,
  redondearA: number,
) {
  const subtotalC = items.reduce((a, i) => a + centavos(precioDe(i)) * i.cantidad, 0);
  let descuentoC = 0;
  if (descuento && num(descuento.valor) > 0) {
    descuentoC =
      descuento.tipo === "monto"
        ? centavos(num(descuento.valor))
        : Math.round((subtotalC * num(descuento.valor)) / 100);
  }
  descuentoC = Math.min(descuentoC, subtotalC);
  const baseC = subtotalC - descuentoC;
  const totalC = redondearA > 1 ? Math.floor(baseC / (redondearA * 100)) * redondearA * 100 : baseC;
  return {
    subtotal: subtotalC / 100,
    descuento: descuentoC / 100,
    redondeo: (totalC - baseC) / 100,
    total: totalC / 100,
    unidades: items.reduce((a, i) => a + i.cantidad, 0),
  };
}
