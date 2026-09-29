import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/** Indicador de pasos para modales/sheets en varias etapas. `actual` empieza en 0. */
export function Stepper({
  pasos,
  actual,
  className,
}: {
  pasos: string[];
  actual: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-center gap-2", className)} aria-label="Pasos">
      {pasos.map((paso, i) => {
        const hecho = i < actual;
        const activo = i === actual;
        return (
          <li
            key={paso}
            className="flex min-w-0 flex-1 items-center gap-2"
            aria-current={activo ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-control text-xs font-semibold tabular-nums",
                hecho || activo ? "bg-foreground text-background" : "bg-surface-3 text-muted",
              )}
            >
              {hecho ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                "text-small truncate font-medium",
                activo ? "text-foreground" : "text-subtle",
                !activo && "max-md:sr-only",
              )}
            >
              {paso}
            </span>
            {i < pasos.length - 1 && <span className="bg-border h-px min-w-3 flex-1" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
