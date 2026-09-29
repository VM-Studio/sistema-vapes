import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Mismo aspecto que el `Stepper` del sistema, pero los pasos ya hechos son
 * botones: tocar uno vuelve a ese paso.
 */
export function StepperVenta({
  pasos,
  actual,
  onIr,
  ariaLabel,
  className,
}: {
  pasos: string[];
  actual: number;
  /** Sin `onIr`, los pasos hechos no se pueden tocar (solo indicador). */
  onIr?: (indice: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-center gap-2", className)} aria-label={ariaLabel}>
      {pasos.map((paso, i) => {
        const hecho = i < actual;
        const activo = i === actual;
        return (
          <li
            key={paso}
            className={cn(
              "flex min-w-0 items-center gap-2",
              // En mobile solo se lee la etiqueta del paso actual: que no se corte.
              activo ? "flex-1 max-md:flex-[1_0_auto]" : "flex-1",
            )}
          >
            <button
              type="button"
              disabled={!hecho || !onIr}
              onClick={() => onIr?.(i)}
              aria-current={activo ? "step" : undefined}
              className="group rounded-control flex min-h-9 min-w-0 items-center gap-2 disabled:cursor-default"
            >
              <span
                className={cn(
                  "rounded-control flex size-6 shrink-0 items-center justify-center text-xs font-semibold tabular-nums transition-colors",
                  hecho || activo ? "bg-foreground text-background" : "bg-surface-3 text-muted",
                  hecho && onIr && "group-hover:bg-primary-hover",
                )}
              >
                {hecho ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-small font-medium whitespace-nowrap",
                  activo ? "text-foreground" : hecho ? "text-muted" : "text-subtle",
                  hecho && onIr && "group-hover:text-foreground group-hover:underline",
                  !activo && "max-md:sr-only",
                )}
              >
                {paso}
              </span>
            </button>
            {i < pasos.length - 1 && <span className="bg-border h-px min-w-3 flex-1" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
