/**
 * "Verificar con pistola" en el paso Productos de la venta: cada escaneo se
 * compara contra el carrito por `varianteId` EXACTO (mismo producto y mismo
 * sabor; otro sabor del mismo modelo NO cuenta). Funciones puras: las usa el
 * modal (contadores "verificadas X/Y") y el servidor (para decidir si la venta
 * queda `verificadaPorEscaneo`).
 */

/** Lo mínimo de una fila del carrito para verificarla. */
export interface ItemAVerificar {
  varianteId: string;
  titulo: string;
  cantidad: number;
}

/** Unidades verificadas por varianteId (ausente = 0). */
export type Verificadas = Readonly<Record<string, number>>;

export type ResultadoVerificacion =
  /** (a) Coincide y faltaban unidades: se sumó una. */
  | { tipo: "ok"; item: ItemAVerificar; verificadas: Verificadas; x: number; y: number }
  /** (b) Coincide pero ya estaban todas verificadas. */
  | { tipo: "completo"; item: ItemAVerificar; y: number }
  /** (c) El código es de un sabor/modelo que no está en la venta. */
  | { tipo: "ajeno" };

export function verificarEscaneo(
  items: readonly ItemAVerificar[],
  verificadas: Verificadas,
  varianteId: string,
): ResultadoVerificacion {
  const item = items.find((i) => i.varianteId === varianteId);
  if (!item) return { tipo: "ajeno" };
  const x = Math.min(verificadas[varianteId] ?? 0, item.cantidad);
  if (x >= item.cantidad) return { tipo: "completo", item, y: item.cantidad };
  return {
    tipo: "ok",
    item,
    verificadas: { ...verificadas, [varianteId]: x + 1 },
    x: x + 1,
    y: item.cantidad,
  };
}

/**
 * Recorta los contadores al carrito actual: nunca más verificadas que la
 * cantidad de la fila, y sin filas que ya no están (se quitó el ítem).
 */
export function ajustarVerificadas(
  items: readonly ItemAVerificar[],
  verificadas: Verificadas,
): Record<string, number> {
  const r: Record<string, number> = {};
  for (const i of items) {
    const n = Math.min(Math.max(0, Math.floor(verificadas[i.varianteId] ?? 0)), i.cantidad);
    if (n > 0) r[i.varianteId] = n;
  }
  return r;
}

/** Unidades que faltan verificar en toda la venta. */
export function faltanVerificar(
  items: readonly ItemAVerificar[],
  verificadas: Verificadas,
): number {
  return items.reduce(
    (a, i) => a + Math.max(0, i.cantidad - Math.min(verificadas[i.varianteId] ?? 0, i.cantidad)),
    0,
  );
}

/**
 * ¿La venta quedó verificada por escaneo? Solo si llegó el detalle de cada
 * ítem y coincide EXACTO con las cantidades vendidas (sin ítems de más ni de
 * menos). El servidor lo recalcula con los ítems que efectivamente vende.
 */
export function ventaVerificada(
  items: readonly { varianteId: string; cantidad: number }[],
  verificacion: readonly { varianteId: string; unidades: number }[] | undefined,
): boolean {
  if (!verificacion || items.length === 0) return false;
  const por = new Map<string, number>();
  for (const v of verificacion) por.set(v.varianteId, (por.get(v.varianteId) ?? 0) + v.unidades);
  if (por.size !== items.length) return false;
  return items.every((i) => por.get(i.varianteId) === i.cantidad);
}

/** Lista "2 × Mango Ice, 1 × Blue Razz" para el aviso de "no corresponde". */
export function listaDeItems(items: readonly ItemAVerificar[]): string {
  return items.map((i) => `${i.cantidad} × ${i.titulo}`).join(", ");
}
