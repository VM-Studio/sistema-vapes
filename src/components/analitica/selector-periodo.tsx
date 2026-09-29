"use client";

import { CalendarRange } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ChipRow } from "@/components/ui/chip";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type ModoSelector = "DIARIO" | "SEMANAL" | "MENSUAL" | "PERSONALIZADO";

const MODOS: { modo: ModoSelector; param: string; label: string }[] = [
  { modo: "DIARIO", param: "diario", label: "Diario" },
  { modo: "SEMANAL", param: "semanal", label: "Semanal" },
  { modo: "MENSUAL", param: "mensual", label: "Mensual" },
  { modo: "PERSONALIZADO", param: "periodo", label: "Período" },
];

const PRESETS = [
  { valor: "7d", label: "Últimos 7 días" },
  { valor: "30d", label: "Últimos 30 días" },
  { valor: "trimestre", label: "Este trimestre" },
  { valor: "anio", label: "Este año" },
] as const;

const chip =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control border px-3 text-sm font-medium whitespace-nowrap transition-colors [&_svg]:size-4";
const chipActivo = "border-foreground bg-foreground text-background";
const chipInactivo = "border-border bg-surface text-muted hover:border-input hover:text-foreground";

/**
 * Selector de período del dashboard y los reportes. El estado vive en la URL
 * (`?modo=diario|semanal|mensual|periodo&desde&hasta&preset`); los demás
 * parámetros de la página se conservan (salvo `page`, que vuelve a la 1).
 */
export function SelectorPeriodo({
  modo,
  desde,
  hasta,
  preset,
  comparacion,
  etiqueta,
}: {
  modo: ModoSelector;
  /** YYYY-MM-DD */
  desde: string;
  hasta: string;
  preset?: string | null;
  /** "vs. ayer", "vs. semana pasada", "vs. 17 ago – 31 ago 2026"… */
  comparacion: string;
  /** "Hoy", "Esta semana", "1 sep – 15 sep 2026"… */
  etiqueta: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [abierto, setAbierto] = useState(modo === "PERSONALIZADO");
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);

  const href = (cambios: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const k of ["modo", "desde", "hasta", "preset", "page"]) sp.delete(k);
    for (const [k, v] of Object.entries(cambios)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  function aplicar(e: FormEvent) {
    e.preventDefault();
    if (!d || !h) return;
    router.push(href({ modo: "periodo", desde: d, hasta: h }), { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3">
      <ChipRow ariaLabel="Período">
        {MODOS.map((m) =>
          m.modo === "PERSONALIZADO" ? (
            <button
              key={m.modo}
              type="button"
              aria-pressed={modo === m.modo}
              aria-expanded={abierto}
              onClick={() => setAbierto((a) => !a)}
              className={cn(chip, modo === m.modo ? chipActivo : chipInactivo)}
            >
              <CalendarRange strokeWidth={1.75} aria-hidden />
              {m.label}
            </button>
          ) : (
            <Link
              key={m.modo}
              href={href({ modo: m.param })}
              scroll={false}
              aria-current={modo === m.modo ? "true" : undefined}
              onClick={() => setAbierto(false)}
              className={cn(chip, modo === m.modo ? chipActivo : chipInactivo)}
            >
              {m.label}
            </Link>
          ),
        )}
      </ChipRow>

      {abierto && (
        <div className="border-border bg-surface flex flex-col gap-3 rounded-card border p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Rangos rápidos">
            {PRESETS.map((p) => (
              <Link
                key={p.valor}
                href={href({ modo: "periodo", preset: p.valor })}
                scroll={false}
                aria-current={modo === "PERSONALIZADO" && preset === p.valor ? "true" : undefined}
                className={cn(
                  chip,
                  "min-h-10 px-3",
                  modo === "PERSONALIZADO" && preset === p.valor ? chipActivo : chipInactivo,
                )}
              >
                {p.label}
              </Link>
            ))}
          </div>
          <form onSubmit={aplicar} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Desde
              <input
                type="date"
                value={d}
                max={h || undefined}
                onChange={(e) => setD(e.target.value)}
                className={cn(controlClass, "h-11 w-40")}
                required
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Hasta
              <input
                type="date"
                value={h}
                min={d || undefined}
                onChange={(e) => setH(e.target.value)}
                className={cn(controlClass, "h-11 w-40")}
                required
              />
            </label>
            <Button type="submit" variant="secondary">
              Aplicar
            </Button>
          </form>
        </div>
      )}

      <p className="text-muted text-sm" data-testid="texto-comparacion">
        <span className="text-foreground font-medium">{etiqueta}</span> · {comparacion}
      </p>
    </div>
  );
}
