import { convertirConCotizacion, fechaHoraCotizacion, type CotizacionVigente } from "@/lib/cambio";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Tooltip } from "@/components/ui/tooltip";

/** "Cotización USDT $ 1.350 · 11/10 15:30 (criptoya.com/dolar)". */
export function textoCotizacionUsdt(c: CotizacionVigente): string {
  return `Cotización USDT ${formatearPesos(c.valor)} · ${fechaHoraCotizacion(c.obtenidoAt)} (${c.fuente})`;
}

/**
 * Equivalente en pesos, en gris, de un monto en USDT ("≈ $ 195.000"), con la
 * cotización usada (valor, fecha/hora y fuente) en un tooltip. La cotización
 * la manda el servidor (cambio.service): acá solo se multiplica. Sin
 * cotización o sin monto, no muestra nada.
 */
export function EquivalenteUsdt({
  monto,
  cotizacion,
  className,
}: {
  monto: string | number | null | undefined;
  cotizacion: CotizacionVigente | null;
  className?: string;
}) {
  const n = typeof monto === "number" ? monto : Number(String(monto ?? "").replace(",", "."));
  if (!cotizacion || monto === null || monto === undefined || monto === "" || !Number.isFinite(n))
    return null;
  const texto = `≈ ${formatearPesos(convertirConCotizacion(n, cotizacion.valor))}`;
  const detalle = textoCotizacionUsdt(cotizacion);
  return (
    <Tooltip content={detalle} className={className}>
      <span
        tabIndex={0}
        aria-label={`${texto}. ${detalle}`}
        className={cn("text-subtle text-xs whitespace-nowrap tabular-nums")}
        data-testid="equivalente-usdt"
      >
        {texto}
      </span>
    </Tooltip>
  );
}
