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

/** "6,27 USDT" o "≈ 6,27 USDT" (compra anterior, calculada en pesos). */
export function textoUsdt(usdt: number, aproximado = false): string {
  return `${aproximado ? "≈ " : ""}${formatearUsdt(usdt)}`;
}

/**
 * Tarjeta grande con el detalle de la compra: ítems y unidades, subtotal,
 * descuento, comisión del pasista, gastos extras, total de mercadería y el
 * COSTO FINAL TOTAL, todo EN USDT (moneda de Compras: `costos` ya viene
 * calculado en USDT, ver vistaCostosUsdt). Arriba, la cotización de la compra.
 * `aproximado`: compra anterior cargada en pesos (sus USDT son equivalentes).
 * Presentacional: la usan el formulario (vista previa en vivo) y el detalle.
 */
export function ResumenCompraCard({
  costos,
  aproximado = false,
  sabores,
  modelos,
  cotizacion,
  titulo = "Detalle de la compra",
  className,
  children,
}: {
  /** En USDT. */
  costos: CostosFinales;
  aproximado?: boolean;
  /** Cantidad de ítems (sabores) y de modelos distintos. */
  sabores: number;
  modelos: number;
  cotizacion: CotizacionResumen | null;
  titulo?: string;
  className?: string;
  /** Debajo del total (controles de comisión/gastos, enlaces…). */
  children?: React.ReactNode;
}) {
  const usdt = (n: number) => textoUsdt(n, aproximado);
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
            : "Sin cotización USDT: no se puede pasar a pesos"}
        </p>
      </header>

      <dl className="flex flex-col gap-2 text-sm">
        <Fila label="Subtotal" texto={usdt(costos.subtotal)} />
        {costos.descuento > 0 && <Fila label="Descuento" texto={`− ${usdt(costos.descuento)}`} />}
        <Fila label="Total de mercadería" texto={usdt(costos.total)} fuerte />
        <Fila
          label={
            costos.comisionPorcentaje === null
              ? "Comisión pasista (sin comisión)"
              : `Comisión pasista (${formatearNumero(costos.comisionPorcentaje)}%)`
          }
          texto={`${costos.comision > 0 ? "+ " : ""}${usdt(costos.comision)}`}
          ariaLabel="Comisión del pasista"
        />
        <Fila
          label="Gastos extras"
          texto={`${costos.gastos > 0 ? "+ " : ""}${usdt(costos.gastos)}`}
          ariaLabel="Gastos extras"
        />
      </dl>

      <div className="bg-surface rounded-card flex flex-col gap-1 p-4">
        <span className="text-muted text-small font-medium tracking-wide uppercase">
          Costo final total
        </span>
        <strong className="text-h1 font-semibold tabular-nums" aria-label="Costo final total">
          {usdt(costos.costoFinalTotal)}
        </strong>
        <p className="text-muted text-small">
          Promedio {usdt(costos.costoUnitarioFinalPromedio)} por unidad. El costo de cada modelo
          (también en dólares y en pesos) está en «Costo final por unidad».
          {aproximado && " Compra cargada en pesos: los USDT son equivalentes con su cotización."}
        </p>
      </div>
      {children}
    </section>
  );
}

function Fila({
  label,
  texto,
  fuerte = false,
  ariaLabel,
}: {
  label: string;
  texto: string;
  fuerte?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        fuerte && "border-border border-t pt-2",
      )}
    >
      <dt className={cn(fuerte ? "font-semibold" : "text-muted")}>{label}</dt>
      <dd className={cn("tabular-nums", fuerte && "font-semibold")} aria-label={ariaLabel}>
        {texto}
      </dd>
    </div>
  );
}
