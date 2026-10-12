"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import {
  horaCotizacion,
  MONEDA_CAMBIO_CORTA,
  MONEDA_CAMBIO_LABEL,
  type CotizacionVigente,
  type MonedaCambioClave,
} from "@/lib/cambio";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CotizacionesBarra = Record<MonedaCambioClave, CotizacionVigente | null>;

const ORDEN: MonedaCambioClave[] = ["USD_BLUE", "USDT"];

function detalle(c: CotizacionVigente | null, moneda: MonedaCambioClave): string {
  if (!c) return `${MONEDA_CAMBIO_LABEL[moneda]}: sin cotización`;
  const origen = c.esManual ? "cargada a mano" : c.fuente;
  return `${MONEDA_CAMBIO_LABEL[moneda]} venta ${formatearPesos(c.valor)} (${origen}, ${horaCotizacion(c.obtenidoAt)})${c.desactualizada ? " — desactualizada" : ""}`;
}

/**
 * "Blue $ 1.540 · USDT $ 1.611 · 15:30" en la barra superior del panel (dueños y
 * empleados que ven el Cotizador). Alerta si alguna lleva más de 2 h sin
 * actualizarse. Los datos los manda el servidor: el cliente nunca consulta APIs externas.
 */
export function WidgetCambio({
  cotizaciones,
  enlace,
}: {
  cotizaciones: CotizacionesBarra;
  /** Dueños: lleva a /configuracion/cambio. */
  enlace: boolean;
}) {
  const vigentes = ORDEN.map((m) => cotizaciones[m]).filter((c): c is CotizacionVigente => !!c);
  if (vigentes.length === 0) return null;
  const desactualizada = vigentes.some((c) => c.desactualizada);
  const masVieja = vigentes.reduce((a, b) => (a.obtenidoAt < b.obtenidoAt ? a : b));
  const titulo = ORDEN.map((m) => detalle(cotizaciones[m], m)).join(" · ");

  const contenido = (
    <>
      {desactualizada && (
        <AlertTriangle
          className="text-warning size-3.5 shrink-0"
          strokeWidth={2}
          aria-label="Cotización desactualizada"
        />
      )}
      <span className="flex flex-col leading-tight sm:flex-row sm:items-center sm:gap-1.5">
        {ORDEN.map((m, i) => {
          const c = cotizaciones[m];
          if (!c) return null;
          return (
            <span key={m} className="whitespace-nowrap">
              {i > 0 && <span className="text-subtle hidden sm:inline">· </span>}
              <span className="text-muted">{MONEDA_CAMBIO_CORTA[m]}</span>{" "}
              <span className="font-semibold tabular-nums">
                {formatearPesos(Math.round(c.valor))}
              </span>
            </span>
          );
        })}
      </span>
      <span className="text-subtle hidden tabular-nums lg:inline">
        {horaCotizacion(masVieja.obtenidoAt)}
      </span>
    </>
  );

  const clase = cn(
    "rounded-control text-foreground flex items-center gap-1.5 px-2 py-1 text-[11px] sm:text-xs",
    desactualizada ? "bg-warning-soft" : "bg-surface-2",
    enlace && "hover:bg-surface-3 transition-colors",
  );

  return enlace ? (
    <Link
      href="/configuracion/cambio"
      className={clase}
      title={titulo}
      aria-label={titulo}
      data-testid="widget-cambio"
    >
      {contenido}
    </Link>
  ) : (
    <span className={clase} title={titulo} aria-label={titulo} data-testid="widget-cambio">
      {contenido}
    </span>
  );
}
