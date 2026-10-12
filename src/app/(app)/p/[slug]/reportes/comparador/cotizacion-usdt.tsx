import { AlertTriangle, Coins } from "lucide-react";
import Link from "next/link";

import { textoCotizacionUsdt } from "@/components/compras/equivalente-usdt";
import { fechaHoraCotizacion, type CotizacionVigente } from "@/lib/cambio";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Cotización USDT con la que el comparador pasa a pesos los precios en USDT.
 * Es GLOBAL (cambio.service): se ve acá y se cambia en Configuración →
 * Cotizaciones (override manual), no por panel.
 */
export function CotizacionUsdtChip({ cotizacion }: { cotizacion: CotizacionVigente | null }) {
  return (
    <Link
      href="/configuracion/cambio"
      title={cotizacion ? textoCotizacionUsdt(cotizacion) : "Sin cotización USDT"}
      data-testid="cotizacion-usdt"
      className={cn(
        "border-border bg-surface rounded-control text-small flex min-h-11 shrink-0 items-center gap-2 border px-3 tabular-nums md:min-h-10",
        "hover:bg-azul-velo-1 transition-colors",
      )}
    >
      {cotizacion?.desactualizada || !cotizacion ? (
        <AlertTriangle className="text-warning size-4" strokeWidth={1.75} aria-hidden />
      ) : (
        <Coins className="text-muted size-4" strokeWidth={1.75} aria-hidden />
      )}
      {cotizacion ? (
        <span>
          USDT <strong className="font-semibold">{formatearPesos(cotizacion.valor)}</strong>
          <span className="text-subtle"> · {fechaHoraCotizacion(cotizacion.obtenidoAt)}</span>
        </span>
      ) : (
        <span className="text-muted">Sin cotización USDT</span>
      )}
    </Link>
  );
}
