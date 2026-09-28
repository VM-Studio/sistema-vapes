"use client";

/* eslint-disable @next/next/no-img-element -- logos subidos por el dueño (storage) o de /public: tamaño fijo y chico, sin optimización de next/image */
import { useEffect, useRef, useState } from "react";

import { inicialesPanel, type PanelBasico } from "@/lib/paneles";
import { cn } from "@/lib/utils";

/**
 * Logo de un panel; sin logo (o si la imagen no carga), un placeholder con
 * sus iniciales sobre el color de acento. `size` en px (alto; el logo
 * conserva su proporción).
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
        style={{ height: size, width: "auto", maxWidth: size * 3 }}
        className={cn("shrink-0 object-contain", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: panel.colorAcento ?? "var(--panel-accent)",
      }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl font-semibold text-white",
        className,
      )}
    >
      {inicialesPanel(panel.nombre)}
    </span>
  );
}
