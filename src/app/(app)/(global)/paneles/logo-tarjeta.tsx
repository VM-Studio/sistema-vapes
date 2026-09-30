"use client";

/* eslint-disable @next/next/no-img-element -- logos del storage o de /public (también previews locales blob:) */
import { useLogoConRespaldo } from "@/components/layout/logo-panel";
import { logosCandidatos } from "@/lib/paneles";
import { cn } from "@/lib/utils";

/**
 * Área del logo en las tarjetas de /paneles: rectángulo blanco de 120px de
 * alto con el logo centrado (contain). Si el logo no carga, prueba el de marca
 * del slug; sin ninguno, el nombre tipografiado.
 */
export function LogoTarjeta({
  nombre,
  slug,
  logoUrl,
  className,
}: {
  nombre: string;
  slug?: string;
  logoUrl: string | null;
  className?: string;
}) {
  const src = useLogoConRespaldo(logosCandidatos(slug, logoUrl));
  return (
    <div
      className={cn(
        "rounded-control bg-background flex h-[120px] items-center justify-center overflow-hidden px-6 py-4",
        className,
      )}
    >
      {src ? (
        <img
          ref={src.ref}
          key={src.url}
          src={src.url}
          alt={`Logo de ${nombre}`}
          onError={src.siguiente}
          className="h-full w-full object-contain"
          draggable={false}
        />
      ) : (
        <span className="text-h1 text-foreground truncate font-semibold tracking-tight">
          {nombre || "Nuevo sistema"}
        </span>
      )}
    </div>
  );
}
