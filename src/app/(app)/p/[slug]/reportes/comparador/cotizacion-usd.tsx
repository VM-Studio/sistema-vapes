"use client";

import { DollarSign } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { guardarCotizacionUsdAction } from "../actions";

/** Cotización del dólar del panel (pesos por US$), editable por el dueño. */
export function CotizacionUsd({ valor }: { valor: number | null }) {
  const [texto, setTexto] = useState(valor ? String(valor) : "");
  const [pendiente, iniciar] = useTransition();
  const { success, error } = useToast();
  const router = useRouter();

  function guardar(e: FormEvent) {
    e.preventDefault();
    const n = texto.trim() === "" ? null : Number(texto.replace(/\./g, "").replace(",", "."));
    iniciar(async () => {
      const r = await guardarCotizacionUsdAction({ cotizacionUsd: n });
      if (!r.ok) return error("No se pudo guardar", r.error.message);
      success(r.data.cotizacionUsd ? "Cotización guardada" : "Cotización borrada");
      router.refresh();
    });
  }

  return (
    <form onSubmit={guardar} className="flex items-end gap-2" data-testid="form-cotizacion">
      <label className="text-muted text-small flex flex-1 flex-col gap-1 md:w-60 md:flex-none">
        Cotización del dólar ($ por US$)
        <span className="relative">
          <DollarSign
            className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            inputMode="decimal"
            className={cn(controlClass, "h-11 pl-9 tabular-nums md:h-10")}
            placeholder="Sin cotización"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-label="Cotización del dólar"
          />
        </span>
      </label>
      <Button type="submit" variant="secondary" loading={pendiente}>
        Guardar
      </Button>
    </form>
  );
}
