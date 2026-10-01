/* eslint-disable @next/next/no-img-element -- foto chica de perfil, tamaño fijo */
import { cn, iniciales } from "@/lib/utils";

/** Avatar circular: foto si hay `src`, si no las iniciales en azul sobre azul suave. */
export function Avatar({
  nombre,
  src,
  className,
}: {
  nombre: string;
  src?: string | null;
  className?: string;
}) {
  const clase = cn(
    "bg-tono-azul-suave text-marca-azul flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-circle text-xs font-semibold",
    className,
  );
  if (src) return <img src={src} alt="" aria-hidden className={cn(clase, "object-cover")} />;
  return (
    <span aria-hidden className={clase}>
      {iniciales(nombre)}
    </span>
  );
}
