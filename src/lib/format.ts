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

/** "US$ 12" / "US$ 12,50" (mismo criterio de centavos que formatearPesos). */
export function formatearDolares(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return "—";
  const t = n.toLocaleString("es-AR", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `US$ ${t}`;
}

/** Monto en la moneda indicada: "USD" → formatearDolares, cualquier otra → pesos. */
export function formatearMonto(valor: string | number | null | undefined, moneda?: string): string {
  return moneda === "USD" ? formatearDolares(valor) : formatearPesos(valor);
}

export function formatearNumero(n: number): string {
  return numero.format(n);
}

/** "+2" / "-2" / "0". */
export function conSigno(n: number): string {
  return n > 0 ? `+${formatearNumero(n)}` : formatearNumero(n);
}

const compacto = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });

/** Ejes de gráficos: "$ 1,2 M" / "350". */
export function formatearCompacto(n: number, moneda = false): string {
  return `${moneda ? "$ " : ""}${compacto.format(n)}`;
}

/** "+6,0 %" / "-3,4 %" (null → "—"). */
export function formatearDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined) return "—";
  const t = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(delta));
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${t} %`;
}
