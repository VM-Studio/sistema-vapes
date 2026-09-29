"use client";

import { Check, Warehouse } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Paso obligatorio antes de cargar stock: una card grande por depósito
 * activo. El último usado puede venir preseleccionado, pero NUNCA se confirma
 * solo: hace falta un tap en "Continuar con {nombre}".
 */
export function SelectorGalpon({
  depositos,
  preseleccionadoId,
  titulo,
  descripcion,
  onConfirmar,
  unidades,
}: {
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
  preseleccionadoId?: string | null;
  titulo: string;
  descripcion?: string;
  onConfirmar: (depositoId: string) => void;
  /** Unidades totales por depósito (opcional): la card las muestra. */
  unidades?: Record<string, number>;
}) {
  const [elegido, setElegido] = useState<string | null>(
    depositos.some((d) => d.id === preseleccionadoId) ? (preseleccionadoId ?? null) : null,
  );
  const deposito = depositos.find((d) => d.id === elegido);

  return (
    <section aria-labelledby="selector-galpon" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 id="selector-galpon" className="text-xl font-semibold tracking-tight md:text-2xl">
          {titulo}
        </h2>
        {descripcion && <p className="text-muted text-sm md:text-base">{descripcion}</p>}
      </div>

      {depositos.length === 0 ? (
        <p className="bg-warning-soft text-warning-soft-foreground rounded-control px-4 py-3 text-sm">
          Este panel no tiene depósitos activos. Creá uno en Configuración → Depósitos.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Galpón" className="grid gap-3 sm:grid-cols-2">
          {depositos.map((d) => {
            const activo = d.id === elegido;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => setElegido(d.id)}
                className={cn(
                  "flex min-h-24 items-center gap-4 rounded-card border-2 p-5 text-left transition-colors",
                  activo
                    ? "border-primary bg-primary-soft"
                    : "border-border bg-surface hover:border-input hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-12 shrink-0 items-center justify-center rounded-control",
                    activo ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted",
                  )}
                >
                  {activo ? (
                    <Check className="size-6" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Warehouse className="size-6" strokeWidth={1.75} aria-hidden />
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-lg font-semibold">{d.nombre}</span>
                  {d.esPrincipal && <span className="text-muted text-sm">Principal</span>}
                  {unidades && (
                    <span className="text-muted text-sm tabular-nums">
                      {(unidades[d.id] ?? 0).toLocaleString("es-AR")}{" "}
                      {(unidades[d.id] ?? 0) === 1 ? "unidad" : "unidades"}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Button
        size="lg"
        className="w-full sm:w-auto sm:self-end"
        disabled={!deposito}
        onClick={() => deposito && onConfirmar(deposito.id)}
      >
        {deposito ? `Continuar con ${deposito.nombre}` : "Elegí un galpón"}
      </Button>
    </section>
  );
}
