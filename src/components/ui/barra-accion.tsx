import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Acción principal de una pantalla: en mobile queda fija abajo (arriba de la
 * bottom bar, blanca con línea superior); en desktop se renderiza en su lugar
 * (normalmente dentro del PageHeader). Con `soloMobile`, en desktop no se ve.
 */
export function BarraAccion({
  children,
  soloMobile = false,
  sinBottomNav = false,
  className,
}: {
  children: ReactNode;
  soloMobile?: boolean;
  /** Pantallas sin bottom bar (flujos a pantalla completa): pegada al borde. */
  sinBottomNav?: boolean;
  className?: string;
}) {
  return (
    <>
      <div
        className={cn(
          "border-border pl-safe pr-safe bg-background fixed inset-x-0 z-20 flex gap-2 border-t px-4 py-3 md:hidden [&>*]:flex-1",
          sinBottomNav
            ? "bottom-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
            : "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
          className,
        )}
      >
        {children}
      </div>
      {/* Reserva el alto de la barra para que no tape el final del contenido. */}
      <div className="h-[4.5rem] md:hidden" aria-hidden />
      {!soloMobile && <div className="hidden gap-2 md:flex">{children}</div>}
    </>
  );
}
