import { Children, type HTMLAttributes, type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Barra propia de filtros de un reporte: tarjeta gris con los controles blancos adentro. */
export function BarraFiltros({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card
      role="group"
      aria-label="Filtros"
      className={cn("mb-4 flex flex-col gap-3 p-4 md:mb-6", className)}
    >
      {children}
    </Card>
  );
}

/**
 * Grilla de métricas: la misma del dashboard (2 columnas en mobile, 3 en lg y
 * todas en una fila en xl). Con 4 o 5 métricas la fila de xl usa 4/5 columnas
 * para que los montos grandes no se salgan; con cantidad impar, en mobile la
 * última ocupa el ancho completo.
 */
export function GrillaKpis({ children, className }: { children: ReactNode; className?: string }) {
  const n = Children.toArray(children).length;
  return (
    <div
      className={cn(
        "mb-4 grid grid-cols-2 gap-3 md:mb-6 md:gap-4 lg:grid-cols-3",
        n >= 6 ? "xl:grid-cols-6" : n === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4",
        "[&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Fila de tabla en mobile: tarjeta blanca con borde fino (va dentro de una SectionCard gris). */
export function FilaMobile({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Card variant="outline" className={cn("p-4", className)} {...props} />;
}
