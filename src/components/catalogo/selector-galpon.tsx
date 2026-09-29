"use client";

import { Check, Warehouse } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatearNumero } from "@/lib/format";
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
      <div className="flex flex-col gap-1">
        <h2 id="selector-galpon" className="text-h2 font-semibold">
          {titulo}
        </h2>
        {descripcion && <p className="text-muted text-body">{descripcion}</p>}
      </div>

      {depositos.length === 0 ? (
        <p className="bg-warning-soft text-warning-soft-foreground rounded-control px-4 py-3 text-sm">
          Este panel no tiene depósitos activos. Creá uno en Configuración → Depósitos.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Galpón" className="grid gap-4 sm:grid-cols-2">
          {depositos.map((d) => {
            const activo = d.id === elegido;
            const n = unidades?.[d.id] ?? 0;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => setElegido(d.id)}
                className={cn(
                  // Tarjeta gris en la página; dentro de un modal/sheet, blanca con borde fino.
                  "bg-card rounded-card relative flex min-h-32 flex-col items-start gap-4 p-5 text-left transition-[background-color,box-shadow] duration-150 md:p-6",
                  "in-[dialog]:border-border in-[dialog]:bg-surface in-[dialog]:border",
                  activo
                    ? "ring-foreground ring-2 in-[dialog]:border-transparent"
                    : "hover:bg-card-hover hover:shadow-card-hover in-[dialog]:hover:bg-surface",
                )}
              >
                <span className="bg-surface text-foreground in-[dialog]:bg-card rounded-control flex size-11 items-center justify-center">
                  <Warehouse className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-h2 truncate font-semibold">{d.nombre}</span>
                  {(d.esPrincipal || unidades) && (
                    <span className="text-muted text-small tabular-nums">
                      {unidades && `${formatearNumero(n)} ${n === 1 ? "unidad" : "unidades"}`}
                      {unidades && d.esPrincipal && " · "}
                      {d.esPrincipal && "Principal"}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "rounded-circle absolute top-5 right-5 flex size-6 items-center justify-center border transition-colors md:top-6 md:right-6",
                    activo
                      ? "border-foreground bg-foreground text-background"
                      : "border-input bg-surface",
                  )}
                >
                  {activo && <Check className="size-4" strokeWidth={2.25} />}
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
