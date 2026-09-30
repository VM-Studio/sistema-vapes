"use client";

/* eslint-disable @next/next/no-img-element -- logos subidos por el dueño (storage) o de /public: tamaño fijo y chico, sin optimización de next/image */
import { useEffect, useRef, useState } from "react";

import { logosCandidatos, type PanelBasico } from "@/lib/paneles";
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
  panel: Pick<PanelBasico, "nombre" | "logoUrl" | "colorAcento"> & { slug?: string };
  size?: number;
  className?: string;
}) {
  const src = useLogoConRespaldo(logosCandidatos(panel.slug, panel.logoUrl));
  if (src) {
    return (
      <img
        ref={src.ref}
        key={src.url}
        src={src.url}
        alt={`Logo de ${panel.nombre}`}
        height={size}
        onError={src.siguiente}
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

/**
 * Recorre `candidatos` hasta dar con una imagen que cargue; null si ninguna.
 * Si una imagen falló ANTES de hidratar, onError ya no se dispara: se revisa
 * al montar cada candidato.
 */
export function useLogoConRespaldo(candidatos: string[]) {
  const [indice, setIndice] = useState(0);
  const ref = useRef<HTMLImageElement>(null);
  const url = candidatos[indice];
  const clave = candidatos.join("|");
  // Si cambian los candidatos (otro panel o nueva preview), se arranca de nuevo.
  const [claveActual, setClaveActual] = useState(clave);
  if (clave !== claveActual) {
    setClaveActual(clave);
    setIndice(0);
  }
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) setIndice((i) => i + 1);
  }, [url]);
  if (!url) return null;
  return { url, ref, siguiente: () => setIndice((i) => i + 1) };
}
