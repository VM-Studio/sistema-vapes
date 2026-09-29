import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";

import { formatearDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * KPI con comparación (mismo aspecto que StatCard): etiqueta gris arriba, valor
 * grande, variación % con flecha (azul de marca si sube, naranja si baja: no
 * depende solo del color) y el valor del período anterior en gris.
 * El 1.er <p> es la etiqueta y el 2.º el valor (lo leen los E2E).
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
      className={cn("bg-card rounded-card flex min-w-0 flex-col gap-1 p-4 md:p-5", className)}
      data-testid={`kpi-${label}`}
    >
      <p className="text-muted text-small truncate font-medium">{label}</p>
      <p className="text-xl leading-tight font-semibold tracking-tight break-words tabular-nums md:text-2xl xl:text-xl 2xl:text-2xl">
        {valor}
      </p>
      <div className="text-small mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span
          className={cn(
            "inline-flex items-center gap-0.5 font-semibold tabular-nums",
            sube && "text-marca-azul",
            baja && "text-marca-naranja-oscuro",
            !sube && !baja && "text-subtle",
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
        <span className="text-subtle min-w-0 tabular-nums">
          {etiquetaAnterior}: <span className="whitespace-nowrap">{anterior}</span>
        </span>
      </div>
      {extra && <p className="text-subtle text-small">{extra}</p>}
    </div>
  );
}
