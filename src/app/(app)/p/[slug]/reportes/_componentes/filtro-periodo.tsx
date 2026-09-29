"use client";

import { controlClass } from "@/components/ui/field";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";
import { PERIODO_LABEL, type Periodo } from "@/lib/zona-horaria";

const PRESETS: Periodo[] = ["hoy", "7d", "30d", "mes", "mes-anterior"];

/** Período de los reportes (en la URL: `periodo` o `desde`/`hasta`). */
export function FiltroPeriodo({
  periodo,
  desde,
  hasta,
}: {
  periodo: Periodo;
  desde: string;
  hasta: string;
}) {
  const { actualizar, pendiente } = useUrlParams();
  const chip = (activo: boolean) =>
    cn(
      "inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors",
      activo
        ? "border-accent bg-accent text-accent-foreground"
        : "border-border bg-surface text-foreground hover:border-input hover:bg-surface-2",
    );
  return (
    <div className={cn("flex flex-col gap-2 transition-opacity", pendiente && "opacity-60")}>
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
        role="group"
        aria-label="Período"
      >
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={chip(periodo === p)}
            aria-pressed={periodo === p}
            onClick={() => actualizar({ periodo: p, desde: null, hasta: null })}
          >
            {PERIODO_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 md:max-w-sm">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Desde
          <input
            type="date"
            className={cn(controlClass, "h-11")}
            value={desde}
            onChange={(e) =>
              e.target.value &&
              actualizar({ periodo: "personalizado", desde: e.target.value, hasta })
            }
          />
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Hasta
          <input
            type="date"
            className={cn(controlClass, "h-11")}
            value={hasta}
            onChange={(e) =>
              e.target.value &&
              actualizar({ periodo: "personalizado", desde, hasta: e.target.value })
            }
          />
        </label>
      </div>
    </div>
  );
}
