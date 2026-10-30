"use client";

import { cn } from "@/lib/utils";

export interface TabItem<V extends string> {
  value: V;
  label: string;
  badge?: number | string;
}

/**
 * Pestañas controladas (estado local). Para pestañas por URL usar <TabsNav>.
 * - `linea` (default): subrayado y texto naranja (módulo activo) en la activa.
 * - `segmentado`: control segmentado (filtros cortos, 2–4 opciones); la opción
 *   elegida va rellena en marrón (antes blanca sobre blanco: no se veía).
 */
export function Tabs<V extends string>({
  items,
  value,
  onChange,
  variant = "linea",
  ariaLabel = "Secciones",
  className,
}: {
  items: TabItem<V>[];
  value: V;
  onChange: (v: V) => void;
  variant?: "linea" | "segmentado";
  ariaLabel?: string;
  className?: string;
}) {
  if (variant === "segmentado") {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          "bg-card border-border rounded-control inline-flex gap-0.5 border p-0.5",
          className,
        )}
      >
        {items.map((t) => {
          const activo = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={activo}
              onClick={() => onChange(t.value)}
              className={cn(
                "rounded-inner h-9 px-3 text-sm font-medium whitespace-nowrap transition-colors md:h-8",
                activo
                  ? "bg-primary text-primary-foreground shadow-control"
                  : "text-muted hover:text-foreground active:bg-surface-3",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="border-border flex min-w-max gap-1 border-b"
      >
        {items.map((t) => {
          const activo = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={activo}
              onClick={() => onChange(t.value)}
              className={cn(
                "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                activo
                  ? "border-brand-orange text-brand-orange-strong font-semibold"
                  : "text-muted hover:text-foreground border-transparent",
              )}
            >
              {t.label}
              {t.badge !== undefined && (
                <span
                  className={cn(
                    "rounded-inner min-w-5 px-1.5 py-0.5 text-center text-xs leading-none tabular-nums",
                    activo
                      ? "bg-brand-orange-strong text-primary-foreground"
                      : "bg-surface-2 text-muted",
                  )}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
