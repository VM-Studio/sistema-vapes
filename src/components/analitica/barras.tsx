import { ChartPlaceholder } from "@/components/ui/chart-theme";
import { formatearNumero, formatearUsdt } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Barra {
  etiqueta: string;
  valor: number;
  /** Texto secundario ("12 ventas"), en gris al lado de la etiqueta. */
  detalle?: string;
  /** Lo mismo en pesos y dólares ("$ 21.000 · US$ 13,30"), chiquito bajo el valor. */
  equivalentes?: string;
}

/** Colores de la marca por barra (solo tokens de gráfico). */
const COLOR = {
  azul: "bg-dato-actual",
  naranja: "bg-dato-anterior",
} as const;

/** Escala categórica fija (ChartTheme.escala): el color sigue a la categoría. */
const ESCALA = [
  "bg-serie-1",
  "bg-serie-2",
  "bg-serie-3",
  "bg-serie-4",
  "bg-serie-5",
  "bg-serie-6",
] as const;

/**
 * Barras horizontales de una sola serie (azul de marca, o un color por barra
 * con `colores`): etiqueta a la izquierda, valor a la derecha y la barra
 * rectangular debajo, sobre un riel gris. Sin valores (todo en 0 o vacío):
 * placeholder, nunca barras vacías.
 */
export function BarrasHorizontales({
  datos,
  moneda = true,
  colores,
  categorias = false,
}: {
  datos: Barra[];
  /** `valor` es un monto en USDT (si no, una cantidad). */
  moneda?: boolean;
  /** Color de cada barra en orden (default: todas azules). */
  colores?: (keyof typeof COLOR)[];
  /** Cada barra es una categoría: toma la escala fija en orden (azul, azul claro, naranja…). */
  categorias?: boolean;
}) {
  const fmt = (v: number) => (moneda ? formatearUsdt(v) : formatearNumero(v));
  if (!datos.some((d) => d.valor)) {
    return (
      <ChartPlaceholder mensaje="Todavía no hay datos en este período" className="h-40 md:h-44" />
    );
  }
  const max = Math.max(...datos.map((d) => d.valor), 0);
  return (
    <ul className="flex flex-col gap-4">
      {datos.map((d, i) => {
        const pct = max > 0 ? Math.max((d.valor / max) * 100, d.valor > 0 ? 1.5 : 0) : 0;
        return (
          <li key={`${d.etiqueta}-${i}`} className="flex flex-col gap-1.5">
            <div className="text-small flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="text-foreground font-medium">{d.etiqueta}</span>
                {d.detalle && <span className="text-subtle"> · {d.detalle}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="font-semibold tabular-nums">{fmt(d.valor)}</span>
                {d.equivalentes && (
                  <span className="text-subtle text-xs tabular-nums">{d.equivalentes}</span>
                )}
              </span>
            </div>
            <div className="bg-surface-3 h-2.5 w-full" aria-hidden>
              <div
                className={cn(
                  "h-full",
                  categorias
                    ? ESCALA[Math.min(i, ESCALA.length - 1)]
                    : COLOR[colores?.[i] ?? "azul"],
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
