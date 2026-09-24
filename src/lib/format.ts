/** Formatos para mostrar (es-AR). Los montos llegan de los servicios como string "9500.00". */

const pesosEnteros = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const pesosDecimales = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});
const numero = new Intl.NumberFormat("es-AR");

/** "$ 14.300" (sin centavos si son ,00) o "$ 1.500,50". */
export function formatearPesos(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? pesosEnteros.format(n) : pesosDecimales.format(n);
}

export function formatearNumero(n: number): string {
  return numero.format(n);
}

/** "+2" / "-2" / "0". */
export function conSigno(n: number): string {
  return n > 0 ? `+${formatearNumero(n)}` : formatearNumero(n);
}
