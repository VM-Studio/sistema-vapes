import { ArrowDownRight, ArrowUpRight, Info, Minus, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { formatearDelta } from "@/lib/format";
import { CLASE_TONO, iconoMetrica, type TonoMetrica } from "@/components/ui/icono-metrica";
import { cn } from "@/lib/utils";

/**
 * KPI con comparación: ícono en un círculo del color de su tono, etiqueta,
 * valor grande y la variación % en una pastilla de color (oliva si sube,
 * naranja si baja; con flecha y signo: no depende solo del color) junto al
 * valor del período anterior. Sin `icono`/`tono`, salen de la etiqueta
 * (iconoMetrica). En pantallas anchas el ícono va a la izquierda;
 * en las angostas, arriba (así los montos grandes siguen entrando).
 * El 1.er <p> es la etiqueta y el 2.º el valor (lo leen los E2E).
 */
export function KpiCard({
  label,
  valor,
  anterior,
  etiquetaAnterior,
  deltaPct,
  extra,
  ayuda,
  icono,
  tono,
  className,
}: {
  label: string;
  valor: ReactNode;
  /** Sin `anterior` (un saldo de hoy, no un período) no se muestra la comparación. */
  anterior?: ReactNode;
  /** "Ayer", "Semana pasada"… */
  etiquetaAnterior?: string;
  deltaPct?: number | null;
  extra?: ReactNode;
  /** Aclaración de qué mide (tooltip con un ícono de info al lado de la etiqueta). */
  ayuda?: string;
  icono?: LucideIcon;
  tono?: TonoMetrica;
  className?: string;
}) {
  const sube = deltaPct != null && deltaPct > 0;
  const baja = deltaPct != null && deltaPct < 0;
  const auto = iconoMetrica(label);
  const Icono = icono ?? auto.icono;
  const Flecha = sube ? ArrowUpRight : baja ? ArrowDownRight : Minus;
  return (
    <div
      className={cn(
        "bg-card rounded-card flex min-w-0 flex-col gap-3 p-4 md:p-5 xl:flex-row xl:gap-4",
        className,
      )}
      data-testid={`kpi-${label}`}
    >
      <span
        aria-hidden
        className={cn(
          "rounded-circle flex size-10 shrink-0 items-center justify-center md:size-11",
          CLASE_TONO[tono ?? auto.tono],
        )}
      >
        <Icono className="size-5" strokeWidth={2} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-muted text-small flex min-w-0 items-center gap-1 font-medium">
          <span className="truncate">{label}</span>
          {ayuda && (
            <Tooltip content={ayuda}>
              <span tabIndex={0} aria-label={ayuda} className="rounded-control inline-flex">
                <Info className="text-subtle size-3.5" strokeWidth={1.75} aria-hidden />
              </span>
            </Tooltip>
          )}
        </p>
        <p className="text-foreground text-xl leading-tight font-bold tracking-tight break-words tabular-nums md:text-2xl xl:text-xl 2xl:text-2xl">
          {valor}
        </p>
        {anterior !== undefined && (
          <div className="text-small mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "rounded-inner inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                sube && "bg-tono-oliva-suave text-tono-oliva",
                baja && "bg-tono-naranja-suave text-tono-naranja",
                !sube && !baja && "bg-surface-2 text-subtle",
              )}
              aria-label={
                deltaPct == null
                  ? "Sin comparación"
                  : `${sube ? "Subió" : baja ? "Bajó" : "Igual"} ${formatearDelta(deltaPct)}`
              }
            >
              <Flecha className="size-3.5" strokeWidth={2.25} aria-hidden />
              {deltaPct == null ? "—" : formatearDelta(deltaPct)}
            </span>
            <span className="text-subtle min-w-0 tabular-nums">
              {etiquetaAnterior}: <span className="whitespace-nowrap">{anterior}</span>
            </span>
          </div>
        )}
        {extra && <div className="text-subtle text-small mt-0.5">{extra}</div>}
      </div>
    </div>
  );
}
