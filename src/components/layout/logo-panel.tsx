"use client";

/* eslint-disable @next/next/no-img-element -- logos subidos por el dueño (storage) o de /public: tamaño fijo y chico, sin optimización de next/image */
import { useEffect, useRef, useState } from "react";

import type { PanelBasico } from "@/lib/paneles";
import { cn } from "@/lib/utils";

/**
 * Logo de un panel; sin logo (o si la imagen no carga), el nombre del panel
 * tipografiado (nunca iniciales ni colores por panel). `size` en px (alto;
 * el logo conserva su proporción).
 */
export function LogoPanel({
  panel,
  size = 32,
  className,
}: {
  panel: Pick<PanelBasico, "nombre" | "logoUrl" | "colorAcento">;
  size?: number;
  className?: string;
}) {
  const [fallo, setFallo] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // Si la imagen falló ANTES de hidratar, onError ya no se dispara: se revisa al montar.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFallo(true);
  }, []);
  if (panel.logoUrl && !fallo) {
    return (
      <img
        ref={img}
        src={panel.logoUrl}
        alt={`Logo de ${panel.nombre}`}
        height={size}
        onError={() => setFallo(true)}
        style={{ height: size, width: "auto", maxWidth: size * 4 }}
        className={cn("shrink-0 object-contain", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ height: size, fontSize: Math.max(12, Math.round(size * 0.5)) }}
      className={cn(
        "text-foreground flex shrink-0 items-center leading-none font-semibold tracking-tight",
        className,
      )}
    >
      {panel.nombre}
    </span>
  );
}
