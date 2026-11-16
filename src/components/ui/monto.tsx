import { textoEquivalentes, textoPrincipal, type Montos } from "@/lib/moneda";
import { cn } from "@/lib/utils";

/**
 * Monto con USDT como moneda principal y, abajo y chiquito, lo mismo en pesos
 * y en dólares (ver src/lib/moneda.ts).
 */
export function Monto({
  montos,
  className,
  claseEquivalentes,
  tachado = false,
}: {
  montos: Montos | null | undefined;
  className?: string;
  claseEquivalentes?: string;
  tachado?: boolean;
}) {
  if (!montos) return <span className={className}>—</span>;
  return (
    <span className={cn("inline-flex flex-col", tachado && "line-through", className)}>
      <span className="tabular-nums">{textoPrincipal(montos)}</span>
      <span className={cn("text-muted text-xs font-normal tabular-nums", claseEquivalentes)}>
        {textoEquivalentes(montos)}
      </span>
    </span>
  );
}
