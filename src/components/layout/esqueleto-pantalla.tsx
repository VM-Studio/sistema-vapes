import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Esqueleto de una pantalla mientras carga (título, KPIs y un bloque), con el
 * mismo ritmo que PageHeader. `className` agrega los márgenes cuando se
 * muestra sin el shell (boundary por encima de los layouts).
 */
export function EsqueletoPantalla({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)} aria-busy="true" aria-label="Cargando">
      <div className="mb-6 flex flex-col gap-2 md:mb-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="rounded-card h-28" />
        ))}
      </div>
      <Skeleton className="rounded-card mt-4 h-64" />
    </div>
  );
}
