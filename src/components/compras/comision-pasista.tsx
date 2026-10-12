"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { cambiarComisionPasistaAction } from "@/app/(app)/p/[slug]/compras/actions";

const soloPorcentaje = (s: string) => s.replace(/[^\d.,]/g, "").slice(0, 6);

/**
 * Checkbox rectangular "Comisión del {10}% para el pasista": la tarjeta entera
 * tilda/destilda y el porcentaje se edita al lado.
 */
export function CheckComisionPasista({
  activa,
  porcentaje,
  onActiva,
  onPorcentaje,
  error,
  disabled,
}: {
  activa: boolean;
  porcentaje: string;
  onActiva: (v: boolean) => void;
  onPorcentaje: (v: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "rounded-card flex min-h-14 flex-wrap items-center gap-3 border px-4 py-3 transition-colors",
          activa ? "border-foreground bg-surface-2" : "border-input bg-surface",
        )}
      >
        <input
          id={id}
          type="checkbox"
          checked={activa}
          disabled={disabled}
          onChange={(e) => onActiva(e.target.checked)}
          className="border-input rounded-inner accent-foreground size-5 shrink-0 cursor-pointer"
        />
        <label htmlFor={id} className="cursor-pointer font-medium">
          Comisión del
        </label>
        <span className="flex items-center gap-1">
          <input
            inputMode="decimal"
            aria-label="Porcentaje de comisión del pasista"
            value={porcentaje}
            disabled={disabled}
            onChange={(e) => onPorcentaje(soloPorcentaje(e.target.value))}
            onFocus={() => !activa && onActiva(true)}
            aria-invalid={error ? true : undefined}
            className={cn(controlClass, "h-10 w-16 text-right font-semibold tabular-nums")}
          />
          <span className="font-medium">%</span>
        </span>
        <label htmlFor={id} className="cursor-pointer font-medium">
          para el pasista
        </label>
      </div>
      {error && (
        <p className="text-danger text-small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** En el detalle de una compra guardada: cambia el tick / % y lo guarda (recalcula en el servidor). */
export function EditarComisionPasista({
  compraId,
  porcentajeActual,
  porcentajeDefault,
}: {
  compraId: string;
  porcentajeActual: string | null;
  porcentajeDefault: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [activa, setActiva] = useState(porcentajeActual !== null);
  const [porcentaje, setPorcentaje] = useState(
    String(porcentajeActual !== null ? Number(porcentajeActual) : porcentajeDefault).replace(
      ".",
      ",",
    ),
  );
  const [error, setError] = useState<string>();
  const [guardando, setGuardando] = useState(false);
  const actual = porcentajeActual === null ? null : Number(porcentajeActual);
  const elegido = activa ? Number(porcentaje.replace(",", ".")) : null;
  const cambio = elegido !== actual;

  async function guardar() {
    setGuardando(true);
    const r = await cambiarComisionPasistaAction({
      id: compraId,
      comisionPasistaPorcentaje: activa ? porcentaje : null,
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error.fields?.comisionPasistaPorcentaje?.[0] ?? r.error.message);
      return;
    }
    setError(undefined);
    toast.success(activa ? "Comisión del pasista actualizada" : "Se quitó la comisión del pasista");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <CheckComisionPasista
        activa={activa}
        porcentaje={porcentaje}
        onActiva={setActiva}
        onPorcentaje={setPorcentaje}
        error={error}
        disabled={guardando}
      />
      {cambio && (
        <Button size="sm" className="self-end" loading={guardando} onClick={() => void guardar()}>
          Guardar comisión
        </Button>
      )}
    </div>
  );
}
