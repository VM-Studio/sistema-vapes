"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { controlClass } from "./field";

/**
 * Cantidad entera editable a mano: se puede borrar y reescribir libremente
 * (mientras se edita, vacío es válido); al salir del campo queda en [min, max].
 */
export function CantidadInput({
  etiqueta,
  valor,
  onCambio,
  min = 1,
  max = 99_999,
  className,
}: {
  etiqueta: string;
  valor: number;
  onCambio: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [borrador, setBorrador] = useState<string | null>(null);
  const acotar = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <input
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={etiqueta}
      className={cn(controlClass, "text-center tabular-nums", className)}
      value={borrador ?? String(valor)}
      onChange={(e) => {
        const t = e.target.value.replace(/\D/g, "").slice(0, String(max).length);
        setBorrador(t);
        if (t !== "") onCambio(acotar(Number(t)));
      }}
      onBlur={() => {
        if (borrador === "") onCambio(min);
        setBorrador(null);
      }}
    />
  );
}
