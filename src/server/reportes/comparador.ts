/**
 * Comparador de proveedores — lógica PURA (sin DB; la testea
 * tests/unit/comparador.test.ts). Recibe las ofertas de los proveedores para
 * un mismo producto y devuelve el orden, las diferencias contra el más barato,
 * el badge y el aviso de precio viejo.
 *
 * Monedas: los precios en USDT se convierten a pesos con la cotización USDT
 * vigente (global, cambio.service) SOLO para ordenar y comparar
 * (`precioArsEquivalente`); el precio del proveedor sigue siendo el suyo. Si
 * no hay cotización (nunca se pudo obtener ni hay override), cada moneda es
 * un grupo con su propio orden y su propio "más barato".
 */

export type MonedaOferta = "ARS" | "USDT";

export interface OfertaProveedor {
  proveedorId: string;
  proveedor: string;
  tienda: string;
  telefono: string | null;
  /** "12500.00" en la moneda del proveedor. */
  precio: string;
  moneda: MonedaOferta;
  actualizadoAt: Date;
  /** Última compra RECIBIDA a ese proveedor de ese producto. */
  ultimaCompra: { fecha: Date; costo: string } | null;
}

export interface OfertaComparada extends OfertaProveedor {
  /** 1 = el más barato de su grupo. */
  posicion: number;
  /** Grupo de orden: "ARS" (todo convertido a pesos con cotización, o solo pesos) o "USDT". */
  grupo: MonedaOferta;
  /** Precio en pesos usado para ordenar (solo USDT con cotización). */
  precioArsEquivalente: string | null;
  /** Diferencia contra el más barato del grupo, en la moneda del grupo ("0.00" para el más barato). */
  diferencia: string;
  /** Diferencia % contra el más barato (1 decimal). */
  diferenciaPct: number;
  masBarato: boolean;
  /** El precio tiene más de `diasDesactualizado` días. */
  desactualizado: boolean;
}

export interface ResultadoComparacion {
  ofertas: OfertaComparada[];
  /** Hay precios en ARS y en USDT y no hay cotización: se muestran en grupos separados. */
  monedasSinConvertir: boolean;
  /** Ahorro por unidad entre el más caro y el más barato del grupo principal. */
  ahorroMaximo: string | null;
}

export const DIAS_DESACTUALIZADO = 30;
const MS_DIA = 86_400_000;

/** "12500.5" → 1250050 (centavos, sin errores de coma flotante al comparar). */
export function aCentavos(monto: string | number): number {
  return Math.round(Number(monto) * 100);
}

const deCentavos = (c: number) => (c / 100).toFixed(2);

export function esDesactualizado(
  actualizadoAt: Date,
  ahora: Date,
  dias = DIAS_DESACTUALIZADO,
): boolean {
  return ahora.getTime() - actualizadoAt.getTime() > dias * MS_DIA;
}

/** Cotización utilizable: número finito > 0. */
export function cotizacionValida(cotizacionUsdt: number | null | undefined): number | null {
  return typeof cotizacionUsdt === "number" && Number.isFinite(cotizacionUsdt) && cotizacionUsdt > 0
    ? cotizacionUsdt
    : null;
}

function ordenarGrupo(
  ofertas: OfertaProveedor[],
  grupo: MonedaOferta,
  valor: (o: OfertaProveedor) => number,
  cotizacion: number | null,
  ahora: Date,
  dias: number,
): OfertaComparada[] {
  const ordenadas = [...ofertas].sort(
    (a, b) =>
      valor(a) - valor(b) ||
      b.actualizadoAt.getTime() - a.actualizadoAt.getTime() ||
      a.proveedor.localeCompare(b.proveedor, "es"),
  );
  const minimo = ordenadas.length ? valor(ordenadas[0]!) : 0;
  return ordenadas.map((o, i) => {
    const v = valor(o);
    const diff = v - minimo;
    return {
      ...o,
      posicion: i + 1,
      grupo,
      precioArsEquivalente:
        cotizacion !== null && o.moneda === "USDT" ? deCentavos(Math.round(v)) : null,
      diferencia: deCentavos(Math.round(diff)),
      diferenciaPct: minimo > 0 ? Math.round((diff / minimo) * 1000) / 10 : 0,
      masBarato: diff === 0,
      desactualizado: esDesactualizado(o.actualizadoAt, ahora, dias),
    };
  });
}

/**
 * Ordena de menor a mayor. Con cotización: un solo grupo en pesos. Sin
 * cotización: primero el grupo ARS y después el USDT, cada uno con su orden.
 * Empates de precio: primero el actualizado más recientemente.
 */
export function compararOfertas(
  ofertas: OfertaProveedor[],
  opciones: { cotizacionUsdt?: number | null; ahora: Date; diasDesactualizado?: number },
): ResultadoComparacion {
  const cotizacion = cotizacionValida(opciones.cotizacionUsdt);
  const dias = opciones.diasDesactualizado ?? DIAS_DESACTUALIZADO;
  if (cotizacion !== null) {
    const valor = (o: OfertaProveedor) =>
      o.moneda === "USDT" ? aCentavos(o.precio) * cotizacion : aCentavos(o.precio);
    const lista = ordenarGrupo(ofertas, "ARS", valor, cotizacion, opciones.ahora, dias);
    return { ofertas: lista, monedasSinConvertir: false, ahorroMaximo: ahorro(lista, valor) };
  }
  const valor = (o: OfertaProveedor) => aCentavos(o.precio);
  const ars = ordenarGrupo(
    ofertas.filter((o) => o.moneda === "ARS"),
    "ARS",
    valor,
    null,
    opciones.ahora,
    dias,
  );
  const usdt = ordenarGrupo(
    ofertas.filter((o) => o.moneda === "USDT"),
    "USDT",
    valor,
    null,
    opciones.ahora,
    dias,
  );
  return {
    ofertas: [...ars, ...usdt],
    monedasSinConvertir: ars.length > 0 && usdt.length > 0,
    ahorroMaximo: ahorro(ars.length ? ars : usdt, valor),
  };
}

function ahorro(lista: OfertaComparada[], valor: (o: OfertaProveedor) => number): string | null {
  if (lista.length < 2) return null;
  return deCentavos(Math.round(valor(lista[lista.length - 1]!) - valor(lista[0]!)));
}
