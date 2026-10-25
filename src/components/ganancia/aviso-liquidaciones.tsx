import { CalendarCheck, ChevronRight } from "lucide-react";
import Link from "next/link";

import { formatearNumero, formatearPesos } from "@/lib/format";
import { nombreMes } from "@/lib/ganancia-vendedor";
import { rutaPanel } from "@/lib/paneles";
import { cn } from "@/lib/utils";
import type { Liquidacion } from "@/server/services/ganancia-vendedor.service";

/**
 * Aviso a los dueños de los meses cerrados sin pagar: "Cerró septiembre: a
 * Trinidad le corresponden $ 45.000 (18 ventas)". Cada fila abre la
 * liquidación en "Ventas de {vendedor}".
 */
export function AvisoLiquidaciones({
  pendientes,
  slug,
  className,
}: {
  pendientes: Liquidacion[];
  slug: string;
  className?: string;
}) {
  if (pendientes.length === 0) return null;
  return (
    <section
      aria-label="Liquidaciones pendientes de pago"
      className={cn("bg-warning-soft rounded-card flex flex-col gap-1 p-2", className)}
      data-testid="aviso-liquidaciones"
    >
      {pendientes.map((l) => (
        <Link
          key={l.id}
          href={rutaPanel(slug, `/equipo/${l.usuario.id}?mes=${l.mes}#ganancia`)}
          className="hover:bg-card/60 rounded-inner flex min-h-14 items-center gap-3 px-3 py-2 transition-colors"
        >
          <CalendarCheck
            className="text-warning-soft-foreground size-5 shrink-0"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="text-warning-soft-foreground min-w-0 flex-1 text-sm">
            <span className="font-semibold">Cerró {nombreMes(l.mes)}:</span> a {l.usuario.nombre} le
            corresponden <span className="font-semibold">{formatearPesos(l.total)}</span> (
            {formatearNumero(l.cantidadVentas)} {l.cantidadVentas === 1 ? "venta" : "ventas"},{" "}
            {formatearNumero(l.unidades)} vapes). Falta registrar el pago.
          </span>
          <ChevronRight
            className="text-warning-soft-foreground size-5 shrink-0"
            strokeWidth={1.75}
            aria-hidden
          />
        </Link>
      ))}
    </section>
  );
}
