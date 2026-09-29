import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";

import { formatearDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * KPI con comparación: valor grande, el del período anterior en chico y la
 * variación % (verde si sube, rojo si baja; con flecha: no depende del color).
 */
export function KpiCard({
  label,
  valor,
  anterior,
  etiquetaAnterior,
  deltaPct,
  extra,
  className,
}: {
  label: string;
  valor: ReactNode;
  anterior: ReactNode;
  /** "Ayer", "Semana pasada"… */
  etiquetaAnterior: string;
  deltaPct: number | null;
  extra?: ReactNode;
  className?: string;
}) {
  const sube = deltaPct !== null && deltaPct > 0;
  const baja = deltaPct !== null && deltaPct < 0;
  const Icono = sube ? ArrowUpRight : baja ? ArrowDownRight : Minus;
  return (
    <div
      className={cn(
        "bg-card flex min-w-0 flex-col gap-1.5 rounded-card p-4 md:p-5",
        className,
      )}
      data-testid={`kpi-${label}`}
    >
      <p className="text-muted truncate text-sm font-medium">{label}</p>
      <p className="text-xl leading-tight font-semibold tracking-tight break-words tabular-nums md:text-2xl xl:text-xl 2xl:text-2xl">
        {valor}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-inner px-1.5 py-0.5 font-semibold tabular-nums",
            sube && "bg-success-soft text-success-soft-foreground",
            baja && "bg-danger-soft text-danger-soft-foreground",
            !sube && !baja && "bg-surface-3 text-muted",
          )}
          aria-label={
            deltaPct === null
              ? "Sin comparación"
              : `${sube ? "Subió" : baja ? "Bajó" : "Igual"} ${formatearDelta(deltaPct)}`
          }
        >
          <Icono className="size-3.5" strokeWidth={2} aria-hidden />
          {deltaPct === null ? "—" : formatearDelta(deltaPct)}
        </span>
        <span className="text-muted tabular-nums">
          {etiquetaAnterior}: {anterior}
        </span>
      </div>
      {extra && <p className="text-muted text-xs">{extra}</p>}
    </div>
  );
}
