import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto mientras carga una pantalla del sistema (navegación instantánea). */
export default function Loading() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Cargando">
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
