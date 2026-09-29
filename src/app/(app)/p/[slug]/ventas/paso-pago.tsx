"use client";

import type { MedioPago } from "@prisma/client";

import type { ClienteElegido } from "@/components/clientes/selector-cliente";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO, MEDIOS_PAGO } from "@/lib/ventas-ui";

import { ICONO_MEDIO_PAGO } from "./_componentes/medio-pago";
import { aCentavos, deCentavos, montoTipeado, precioCobrado, type ItemVenta } from "./estado-venta";

export function PasoPago({
  deposito,
  cliente,
  items,
  medioPago,
  descuento,
  notas,
  puedeEditar,
  bloqueado = false,
  totales,
  onMedioPago,
  onDescuento,
  onNotas,
}: {
  deposito: string;
  cliente: ClienteElegido;
  items: ItemVenta[];
  medioPago: MedioPago | null;
  descuento: string;
  notas: string;
  puedeEditar: boolean;
  /** Venta desde una cotización: sin descuento ni notas editables (precios cotizados). */
  bloqueado?: boolean;
  totales: { unidades: number; subtotal: string; descuento: string; total: string };
  onMedioPago: (m: MedioPago) => void;
  onDescuento: (d: string) => void;
  onNotas: (n: string) => void;
}) {
  const descuentoInvalido = descuento.trim() !== "" && montoTipeado(descuento) === null;
  const descuentoExcede =
    !descuentoInvalido &&
    descuento.trim() !== "" &&
    aCentavos(montoTipeado(descuento) ?? 0) > aCentavos(totales.subtotal);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col">
          <legend className="text-h2 mb-4 font-semibold">¿Cómo paga?</legend>
          <div role="radiogroup" aria-label="Medio de pago" className="grid gap-2 sm:grid-cols-3">
            {MEDIOS_PAGO.map((m) => {
              const Icono = ICONO_MEDIO_PAGO[m];
              const activo = medioPago === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  onClick={() => onMedioPago(m)}
                  className={cn(
                    "text-body rounded-control flex min-h-14 items-center gap-3 border px-4 text-left font-semibold transition-colors sm:min-h-24 sm:flex-col sm:justify-center sm:text-center",
                    activo
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground bg-surface text-foreground hover:bg-surface-2",
                  )}
                >
                  <Icono
                    className={cn("size-6", activo ? "text-background" : "text-muted")}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {ETIQUETA_MEDIO_PAGO[m]}
                </button>
              );
            })}
          </div>
        </fieldset>

        {!bloqueado && (
          <div className="bg-card rounded-card flex flex-col gap-4 p-4 md:p-5">
            {puedeEditar && (
              <Input
                label="Descuento ($)"
                inputMode="decimal"
                placeholder="0"
                value={descuento}
                onChange={(e) => onDescuento(e.target.value)}
                error={
                  descuentoInvalido
                    ? "Monto inválido"
                    : descuentoExcede
                      ? `Máximo ${formatearPesos(totales.subtotal)}`
                      : undefined
                }
                className="tabular-nums"
              />
            )}

            <Textarea
              label="Notas (opcional)"
              rows={2}
              maxLength={2000}
              value={notas}
              onChange={(e) => onNotas(e.target.value)}
            />
          </div>
        )}
      </div>

      <section
        aria-label="Resumen de la venta"
        className="bg-card rounded-card flex flex-col gap-3 self-start p-4 md:p-5"
      >
        <h3 className="text-h3 font-semibold">Resumen</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Galpón</dt>
          <dd className="text-right font-medium">{deposito}</dd>
          <dt className="text-muted">Cliente</dt>
          <dd className="text-right font-medium">
            {cliente.nombre}
            {cliente.tipo === "nuevo" && <span className="text-muted font-normal"> (nuevo)</span>}
          </dd>
          {medioPago && (
            <>
              <dt className="text-muted">Pago</dt>
              <dd className="text-right font-medium">{ETIQUETA_MEDIO_PAGO[medioPago]}</dd>
            </>
          )}
        </dl>
        <ul className="border-border flex flex-col gap-1.5 border-t pt-3 text-sm">
          {items.map((i) => (
            <li key={i.varianteId} className="flex justify-between gap-3">
              <span className="min-w-0">
                {i.cantidad} × {i.titulo}
                {i.precioEspecial !== null && (
                  <span className="text-muted block text-xs">
                    {bloqueado ? "Precio cotizado" : "Precio especial"}{" "}
                    {formatearPesos(i.precioEspecial)}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatearPesos(deCentavos(aCentavos(precioCobrado(i)) * i.cantidad))}
              </span>
            </li>
          ))}
        </ul>
        <dl className="border-border grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-sm">
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-right tabular-nums">{formatearPesos(totales.subtotal)}</dd>
          {Number(totales.descuento) > 0 && (
            <>
              <dt className="text-muted">Descuento</dt>
              <dd className="text-right tabular-nums">−{formatearPesos(totales.descuento)}</dd>
            </>
          )}
          <dt className="text-h3 font-semibold">Total</dt>
          <dd className="text-h3 text-right font-semibold tabular-nums">
            {formatearPesos(totales.total)}
          </dd>
        </dl>
      </section>
    </div>
  );
}
