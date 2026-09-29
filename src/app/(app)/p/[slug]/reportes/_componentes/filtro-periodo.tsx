"use client";

import { FilterChip } from "@/components/ui/chip";
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
  return (
    <div
      className={cn(
        "flex flex-col gap-3 transition-opacity lg:flex-row lg:items-end lg:justify-between",
        pendiente && "opacity-60",
      )}
    >
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0"
        role="group"
        aria-label="Período"
      >
        {PRESETS.map((p) => (
          <FilterChip
            key={p}
            className="h-11 md:h-10"
            activo={periodo === p}
            onClick={() => actualizar({ periodo: p, desde: null, hasta: null })}
          >
            {PERIODO_LABEL[p]}
          </FilterChip>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:w-80">
        <label className="text-muted text-small flex flex-col gap-1">
          Desde
          <input
            type="date"
            className={cn(controlClass, "h-11 md:h-10")}
            value={desde}
            onChange={(e) =>
              e.target.value &&
              actualizar({ periodo: "personalizado", desde: e.target.value, hasta })
            }
          />
        </label>
        <label className="text-muted text-small flex flex-col gap-1">
          Hasta
          <input
            type="date"
            className={cn(controlClass, "h-11 md:h-10")}
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
