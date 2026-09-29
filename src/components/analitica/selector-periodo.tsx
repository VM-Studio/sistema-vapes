"use client";

import { CalendarRange } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ChipLink, ChipRow } from "@/components/ui/chip";
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

/** Segmento del grupo de modos: rectangular, 44px en mobile; activo negro con texto blanco. */
const segmento =
  "inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-inner px-3 text-sm font-medium whitespace-nowrap transition-colors md:h-9 md:flex-none [&_svg]:size-4";
const segmentoActivo = "bg-foreground text-background";
const segmentoInactivo = "text-muted hover:bg-surface-2 hover:text-foreground";

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
  alinear = "inicio",
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
  /** "fin": alineado a la derecha en desktop (cabecera del dashboard). */
  alinear?: "inicio" | "fin";
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
    <div
      className={cn("flex w-full flex-col gap-2", alinear === "fin" && "md:w-auto md:items-end")}
    >
      <div
        role="group"
        aria-label="Período"
        className="border-border bg-surface rounded-control flex w-full gap-0.5 border p-0.5 md:w-auto"
      >
        {MODOS.map((m) =>
          m.modo === "PERSONALIZADO" ? (
            <button
              key={m.modo}
              type="button"
              aria-pressed={modo === m.modo}
              aria-expanded={abierto}
              onClick={() => setAbierto((a) => !a)}
              className={cn(segmento, modo === m.modo ? segmentoActivo : segmentoInactivo)}
            >
              <CalendarRange strokeWidth={1.75} aria-hidden className="hidden sm:block" />
              {m.label}
            </button>
          ) : (
            <Link
              key={m.modo}
              href={href({ modo: m.param })}
              scroll={false}
              aria-current={modo === m.modo ? "true" : undefined}
              onClick={() => setAbierto(false)}
              className={cn(segmento, modo === m.modo ? segmentoActivo : segmentoInactivo)}
            >
              {m.label}
            </Link>
          ),
        )}
      </div>

      <p className="text-muted text-small" data-testid="texto-comparacion">
        <span className="text-foreground font-medium">{etiqueta}</span> · {comparacion}
      </p>

      {abierto && (
        <div className="bg-card rounded-card flex w-full flex-col gap-4 p-4 md:w-auto">
          <ChipRow ariaLabel="Rangos rápidos" className="-mx-4 px-4 py-0 md:mx-0 md:px-0">
            {PRESETS.map((p) => (
              <ChipLink
                key={p.valor}
                href={href({ modo: "periodo", preset: p.valor })}
                activo={modo === "PERSONALIZADO" && preset === p.valor}
                className="h-11 md:h-9"
              >
                {p.label}
              </ChipLink>
            ))}
          </ChipRow>
          <form onSubmit={aplicar} className="grid grid-cols-2 items-end gap-3 md:flex">
            <label className="text-small flex min-w-0 flex-col gap-1.5 font-medium">
              Desde
              <input
                type="date"
                value={d}
                max={h || undefined}
                onChange={(e) => setD(e.target.value)}
                className={cn(controlClass, "h-11 md:h-10 md:w-40")}
                required
              />
            </label>
            <label className="text-small flex min-w-0 flex-col gap-1.5 font-medium">
              Hasta
              <input
                type="date"
                value={h}
                min={d || undefined}
                onChange={(e) => setH(e.target.value)}
                className={cn(controlClass, "h-11 md:h-10 md:w-40")}
                required
              />
            </label>
            <Button type="submit" variant="secondary" className="col-span-2 md:col-span-1">
              Aplicar
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
