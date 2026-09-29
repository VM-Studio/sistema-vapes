"use client";

import { Camera } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Abre el escáner por cámara (al lado de un buscador). */
export function BotonCamara({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      className={className ?? "size-11 shrink-0"}
      onClick={onClick}
      aria-label="Escanear con la cámara"
      title="Escanear con la cámara"
    >
      <Camera strokeWidth={1.75} />
    </Button>
  );
}
