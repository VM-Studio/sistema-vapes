import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto mientras carga una pantalla del sistema (navegación instantánea).
 * Este boundary está por encima de los layouts de panel y global: se muestra
 * sin la barra ni el sidebar, así que lleva sus propios márgenes (los mismos
 * que el contenido de AppShell) para no quedar pegado al borde.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto flex w-full max-w-[1280px] min-w-0 flex-col px-4 pt-[calc(3.5rem+env(safe-area-inset-top)+1.5rem)] pb-6 md:px-8 md:pb-8"
      aria-busy="true"
      aria-label="Cargando"
    >
      {/* Mismo ritmo que PageHeader: título, subtítulo y margen inferior. */}
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
