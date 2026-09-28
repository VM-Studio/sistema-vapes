"use client";

import type { MedioPago } from "@prisma/client";
import { Banknote, Bitcoin, Landmark, type LucideIcon } from "lucide-react";

import type { ClienteElegido } from "@/components/clientes/selector-cliente";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO, MEDIOS_PAGO } from "@/lib/ventas-ui";

import { aCentavos, deCentavos, montoTipeado, precioCobrado, type ItemVenta } from "./estado-venta";

const ICONO_MEDIO: Record<MedioPago, LucideIcon> = {
  EFECTIVO: Banknote,
  TRANSFERENCIA: Landmark,
  BINANCE: Bitcoin,
};

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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-lg font-semibold">¿Cómo paga?</legend>
          <div role="radiogroup" aria-label="Medio de pago" className="grid gap-3 sm:grid-cols-3">
            {MEDIOS_PAGO.map((m) => {
              const Icono = ICONO_MEDIO[m];
              const activo = medioPago === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  onClick={() => onMedioPago(m)}
                  className={cn(
                    "flex min-h-20 items-center gap-3 rounded-2xl border-2 p-4 text-left text-lg font-semibold transition-colors sm:flex-col sm:justify-center sm:text-center",
                    activo
                      ? "border-primary bg-primary-soft"
                      : "border-border bg-surface hover:border-input hover:bg-surface-2",
                  )}
                >
                  <Icono
                    className={cn("size-7", activo ? "text-primary" : "text-muted")}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {ETIQUETA_MEDIO_PAGO[m]}
                </button>
              );
            })}
          </div>
        </fieldset>

        {puedeEditar && !bloqueado && (
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

        {!bloqueado && (
          <Textarea
            label="Notas (opcional)"
            rows={2}
            maxLength={2000}
            value={notas}
            onChange={(e) => onNotas(e.target.value)}
          />
        )}
      </div>

      <section
        aria-label="Resumen de la venta"
        className="border-border bg-surface-2 flex flex-col gap-3 self-start rounded-2xl border p-4"
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Galpón</dt>
          <dd className="text-right font-medium">{deposito}</dd>
          <dt className="text-muted">Cliente</dt>
          <dd className="text-right font-medium">
            {cliente.nombre}
            {cliente.tipo === "nuevo" && <span className="text-primary"> (nuevo)</span>}
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
                  <span className="text-primary block text-xs">
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
          <dt className="text-base font-semibold">Total</dt>
          <dd className="text-right text-base font-semibold tabular-nums">
            {formatearPesos(totales.total)}
          </dd>
        </dl>
      </section>
    </div>
  );
}
