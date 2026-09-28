import { formatearPesos } from "@/lib/format";

const dolares = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "code",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Precio de proveedor: "$ 14.300" en pesos, "USD 12,50" en dólares. */
export function formatearMonto(
  valor: string | number | null | undefined,
  moneda: "ARS" | "USD" | null | undefined,
): string {
  if (moneda !== "USD") return formatearPesos(valor);
  if (valor === null || valor === undefined || valor === "") return "—";
  const n = Number(valor);
  return Number.isFinite(n) ? dolares.format(n) : "—";
}
