/* eslint-disable @next/next/no-img-element -- logos del storage o de /public (también previews locales blob:) */
import { cn } from "@/lib/utils";

/**
 * Área del logo en las tarjetas de /paneles: rectángulo blanco de 120px de
 * alto con el logo centrado (contain). Sin logo, el nombre tipografiado.
 */
export function LogoTarjeta({
  nombre,
  logoUrl,
  className,
}: {
  nombre: string;
  logoUrl: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-control bg-background flex h-[120px] items-center justify-center overflow-hidden px-6 py-4",
        className,
      )}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`Logo de ${nombre}`}
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
