import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";

import { formatearDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Tarjeta de KPI con la variación contra el período anterior: verde si
 * mejora, rojo si empeora (para gastos se invierte). Flecha + texto: el
 * sentido nunca queda solo en el color.
 */
export function Kpi({
  label,
  valor,
  delta,
  invertido = false,
  hint,
  className,
}: {
  label: string;
  valor: ReactNode;
  delta?: number | null;
  invertido?: boolean;
  hint?: string;
  className?: string;
}) {
  const hayDelta = delta !== undefined;
  const bueno = delta != null && (invertido ? delta < 0 : delta > 0);
  const malo = delta != null && (invertido ? delta > 0 : delta < 0);
  const Icono = delta == null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div
      className={cn(
        "border-border bg-surface flex min-w-0 flex-col gap-1 rounded-xl border p-4",
        className,
      )}
    >
      <p className="text-muted truncate text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="truncate text-xl font-semibold tabular-nums sm:text-2xl">{valor}</p>
      {hayDelta && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium whitespace-nowrap tabular-nums",
              bueno && "bg-success-soft text-success-soft-foreground",
              malo && "bg-danger-soft text-danger-soft-foreground",
              !bueno && !malo && "bg-surface-2 text-muted",
            )}
          >
            <Icono className="size-3" aria-hidden />
            {delta == null ? "sin datos" : formatearDelta(delta)}
          </span>
          <span className="text-muted">{hint ?? "vs. período anterior"}</span>
        </p>
      )}
    </div>
  );
}
