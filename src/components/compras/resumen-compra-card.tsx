import type { CostosFinales } from "@/lib/costos-compra";
import { formatearNumero, formatearPesos, formatearUsdt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Cotización USDT con la que se muestran los equivalentes ("1 USDT = $ X"). */
export interface CotizacionResumen {
  /** Pesos por USDT. */
  valor: number;
  /** De dónde sale: "guardada en la compra", "vigente · 25/10 15:30 (criptoya)"… */
  origen: string;
}

/** Pesos → USDT con 2 decimales (null sin cotización). */
export function pesosAUsdt(pesos: number, cotizacion: CotizacionResumen | null): number | null {
  if (!cotizacion || !(cotizacion.valor > 0)) return null;
  return Math.round((pesos / cotizacion.valor) * 100) / 100;
}

/**
 * Tarjeta grande con el detalle de la compra: ítems y unidades, subtotal,
 * descuento, comisión del pasista, gastos extras, total de mercadería y el
 * COSTO FINAL TOTAL, cada monto con su equivalente en USDT y la cotización
 * usada. Sin cotización lo dice y muestra solo pesos. Presentacional: la
 * usan el formulario (vista previa en vivo) y el detalle de la compra.
 */
export function ResumenCompraCard({
  costos,
  sabores,
  modelos,
  cotizacion,
  titulo = "Detalle de la compra",
  className,
  children,
}: {
  costos: CostosFinales;
  /** Cantidad de ítems (sabores) y de modelos distintos. */
  sabores: number;
  modelos: number;
  cotizacion: CotizacionResumen | null;
  titulo?: string;
  className?: string;
  /** Debajo del total (controles de comisión/gastos, enlaces…). */
  children?: React.ReactNode;
}) {
  const usdt = (pesos: number) => {
    const u = pesosAUsdt(pesos, cotizacion);
    return u === null ? null : formatearUsdt(u);
  };
  return (
    <section
      aria-label={titulo}
      className={cn("bg-card rounded-card flex flex-col gap-5 p-5 md:p-6", className)}
      data-testid="resumen-compra"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-h3 font-semibold">{titulo}</h2>
          <p className="text-muted text-small">
            {formatearNumero(sabores)} {sabores === 1 ? "ítem" : "ítems"} ·{" "}
            {formatearNumero(modelos)} {modelos === 1 ? "modelo" : "modelos"} ·{" "}
            <span aria-label="Unidades">{formatearNumero(costos.unidades)} unidades</span>
          </p>
        </div>
        <p
          className={cn(
            "rounded-control px-2.5 py-1 text-xs font-medium",
            cotizacion ? "bg-surface text-muted" : "bg-warning-soft text-warning-soft-foreground",
          )}
          data-testid="cotizacion-resumen"
        >
          {cotizacion
            ? `1 USDT = ${formatearPesos(cotizacion.valor)} · ${cotizacion.origen}`
            : "Sin cotización USDT: se muestran solo pesos"}
        </p>
      </header>

      <dl className="flex flex-col gap-2 text-sm">
        <Fila label="Subtotal" pesos={costos.subtotal} usdt={usdt(costos.subtotal)} />
        {costos.descuento > 0 && (
          <Fila
            label="Descuento"
            pesos={-costos.descuento}
            usdt={usdt(costos.descuento) && `− ${usdt(costos.descuento)}`}
          />
        )}
        <Fila label="Total de mercadería" pesos={costos.total} usdt={usdt(costos.total)} fuerte />
        <Fila
          label={
            costos.comisionPorcentaje === null
              ? "Comisión pasista (sin comisión)"
              : `Comisión pasista (${formatearNumero(costos.comisionPorcentaje)}%)`
          }
          pesos={costos.comision}
          usdt={usdt(costos.comision)}
          signo
          ariaLabel="Comisión del pasista"
        />
        <Fila
          label="Gastos extras"
          pesos={costos.gastos}
          usdt={usdt(costos.gastos)}
          signo
          ariaLabel="Gastos extras"
        />
      </dl>

      <div className="bg-surface rounded-card flex flex-col gap-1 p-4">
        <span className="text-muted text-small font-medium tracking-wide uppercase">
          Costo final total
        </span>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <strong className="text-h1 font-semibold tabular-nums" aria-label="Costo final total">
            {formatearPesos(costos.costoFinalTotal)}
          </strong>
          {usdt(costos.costoFinalTotal) && (
            <span
              className="text-h3 text-muted font-semibold tabular-nums"
              aria-label="Costo final total en USDT"
            >
              ≈ {usdt(costos.costoFinalTotal)}
            </span>
          )}
        </div>
        <p className="text-muted text-small">
          Promedio {formatearPesos(costos.costoUnitarioFinalPromedio)} por unidad
          {usdt(costos.costoUnitarioFinalPromedio) &&
            ` (≈ ${usdt(costos.costoUnitarioFinalPromedio)})`}
          . El costo de cada modelo está en «Costo final por unidad».
        </p>
      </div>
      {children}
    </section>
  );
}

function Fila({
  label,
  pesos,
  usdt,
  fuerte = false,
  signo = false,
  ariaLabel,
}: {
  label: string;
  pesos: number;
  usdt: string | null;
  fuerte?: boolean;
  signo?: boolean;
  ariaLabel?: string;
}) {
  const texto =
    pesos < 0
      ? `− ${formatearPesos(-pesos)}`
      : `${signo && pesos > 0 ? "+ " : ""}${formatearPesos(pesos)}`;
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        fuerte && "border-border border-t pt-2",
      )}
    >
      <dt className={cn(fuerte ? "font-semibold" : "text-muted")}>{label}</dt>
      <dd className="flex flex-col items-end">
        <span className={cn("tabular-nums", fuerte && "font-semibold")} aria-label={ariaLabel}>
          {texto}
        </span>
        {usdt && <span className="text-subtle text-xs tabular-nums">≈ {usdt}</span>}
      </dd>
    </div>
  );
}
