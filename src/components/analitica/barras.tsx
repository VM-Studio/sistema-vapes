import { ChartPlaceholder } from "@/components/ui/chart-theme";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Barra {
  etiqueta: string;
  valor: number;
  /** Texto secundario ("12 ventas"), en gris al lado de la etiqueta. */
  detalle?: string;
}

/** Colores de la marca por barra (solo tokens de gráfico). */
const COLOR = {
  azul: "bg-dato-actual",
  naranja: "bg-dato-anterior",
} as const;

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
}: {
  datos: Barra[];
  moneda?: boolean;
  /** Color de cada barra en orden (default: todas azules). */
  colores?: (keyof typeof COLOR)[];
}) {
  const fmt = (v: number) => (moneda ? formatearPesos(v) : v.toLocaleString("es-AR"));
  if (!datos.some((d) => d.valor)) {
    return <ChartPlaceholder mensaje="Sin datos en el período" className="h-40 md:h-44" />;
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
              <span className="shrink-0 font-semibold tabular-nums">{fmt(d.valor)}</span>
            </div>
            <div className="bg-surface-3 h-2.5 w-full" aria-hidden>
              <div
                className={cn("h-full", COLOR[colores?.[i] ?? "azul"])}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
