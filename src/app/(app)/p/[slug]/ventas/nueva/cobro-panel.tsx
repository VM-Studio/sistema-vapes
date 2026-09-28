"use client";

import { MedioPago } from "@prisma/client";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO, MEDIOS_PAGO } from "@/lib/ventas-ui";

import { centavos, num, type DescuentoGlobal } from "./tipos";

const soloDecimal = (s: string) => s.replace(/[^\d.,]/g, "");

/**
 * Cobro: descuento (con permiso), redondeo y UN medio de pago. El total se
 * cobra entero; con efectivo, "recibido" solo sirve para calcular el vuelto
 * en pantalla (no se registra). El servidor recalcula todo.
 */
export function CobroPanel({
  totales,
  redondeoConfig,
  redondear,
  onRedondear,
  descuento,
  onDescuento,
  puedeEditar,
  enviando,
  onConfirmar,
  autoFocus,
}: {
  totales: { subtotal: number; descuento: number; redondeo: number; total: number };
  redondeoConfig: number;
  redondear: boolean;
  onRedondear: (v: boolean) => void;
  descuento: DescuentoGlobal | null;
  onDescuento: (d: DescuentoGlobal | null) => void;
  puedeEditar: boolean;
  enviando: boolean;
  onConfirmar: (medioPago: MedioPago, meta: { vuelto: number }) => void;
  autoFocus?: boolean;
}) {
  const [medio, setMedio] = useState<MedioPago>(MedioPago.EFECTIVO);
  const [recibido, setRecibido] = useState("");
  const recibidoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && medio === MedioPago.EFECTIVO) recibidoRef.current?.focus();
  }, [autoFocus, medio]);

  const totalC = centavos(totales.total);
  const recibidoC = centavos(num(recibido));
  const esEfectivo = medio === MedioPago.EFECTIVO;
  const faltaC = esEfectivo && recibido.trim() !== "" ? Math.max(0, totalC - recibidoC) : 0;
  const vueltoC = esEfectivo ? Math.max(0, recibidoC - totalC) : 0;
  const puedeConfirmar = totalC >= 0 && faltaC === 0 && !enviando;

  return (
    <div className="flex flex-col gap-4">
      {/* Totales */}
      <dl className="flex flex-col gap-1 text-sm">
        {(totales.descuento > 0 || totales.redondeo !== 0) && (
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="tabular-nums">{formatearPesos(totales.subtotal)}</dd>
          </div>
        )}
        {totales.descuento > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted">Descuento</dt>
            <dd className="tabular-nums">−{formatearPesos(totales.descuento)}</dd>
          </div>
        )}
        {totales.redondeo !== 0 && (
          <div className="flex justify-between">
            <dt className="text-muted">Redondeo</dt>
            <dd className="tabular-nums">{formatearPesos(totales.redondeo)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <dt className="font-semibold">Total</dt>
          <dd className="text-3xl font-bold tabular-nums" data-testid="total-cobro">
            {formatearPesos(totales.total)}
          </dd>
        </div>
      </dl>

      {redondeoConfig > 0 && (
        <Switch
          label={`Redondear a múltiplos de ${formatearPesos(redondeoConfig)} (a favor del cliente)`}
          checked={redondear}
          onCheckedChange={onRedondear}
        />
      )}

      {puedeEditar && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium">Descuento</legend>
          <div className="flex gap-2">
            <select
              aria-label="Tipo de descuento"
              className={cn(controlClass, "h-11 w-24")}
              value={descuento?.tipo ?? "porcentaje"}
              onChange={(e) =>
                onDescuento({
                  tipo: e.target.value as DescuentoGlobal["tipo"],
                  valor: descuento?.valor ?? "",
                })
              }
            >
              <option value="porcentaje">%</option>
              <option value="monto">$</option>
            </select>
            <input
              inputMode="decimal"
              aria-label="Descuento"
              placeholder="0"
              className={cn(controlClass, "h-11 flex-1 text-right tabular-nums")}
              value={descuento?.valor ?? ""}
              onChange={(e) => {
                const valor = soloDecimal(e.target.value);
                onDescuento(valor ? { tipo: descuento?.tipo ?? "porcentaje", valor } : null);
              }}
            />
          </div>
        </fieldset>
      )}

      {/* Medio de pago (uno solo: se cobra el total) */}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Medio de pago</legend>
        <div role="radiogroup" aria-label="Medio de pago" className="grid grid-cols-3 gap-2">
          {MEDIOS_PAGO.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={medio === m}
              onClick={() => setMedio(m)}
              className={cn(
                "border-border min-h-11 rounded-xl border px-2 text-sm font-medium transition-colors",
                medio === m
                  ? "border-primary bg-primary-soft text-primary-soft-foreground"
                  : "bg-surface hover:bg-surface-2",
              )}
            >
              {ETIQUETA_MEDIO_PAGO[m]}
            </button>
          ))}
        </div>
      </fieldset>

      {esEfectivo && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Efectivo recibido (opcional, para el vuelto)
          <input
            ref={recibidoRef}
            inputMode="decimal"
            aria-label="Efectivo recibido"
            placeholder={String(totales.total)}
            className={cn(controlClass, "h-11 text-right text-base font-semibold tabular-nums")}
            value={recibido}
            onChange={(e) => setRecibido(soloDecimal(e.target.value))}
          />
        </label>
      )}

      <div aria-live="polite" className="flex flex-col gap-1 text-sm">
        {vueltoC > 0 && (
          <p className="bg-success-soft text-success-soft-foreground flex items-center justify-between rounded-xl px-3 py-2 text-base font-semibold">
            <span>Vuelto</span>
            <span className="tabular-nums" data-testid="vuelto">
              {formatearPesos(vueltoC / 100)}
            </span>
          </p>
        )}
        {faltaC > 0 && (
          <p className="bg-warning-soft text-warning-soft-foreground flex justify-between rounded-xl px-3 py-2 font-medium">
            <span>Falta cobrar</span>
            <span className="tabular-nums">{formatearPesos(faltaC / 100)}</span>
          </p>
        )}
      </div>

      <Button
        size="lg"
        fullWidth
        onClick={() => onConfirmar(medio, { vuelto: vueltoC / 100 })}
        disabled={!puedeConfirmar}
        loading={enviando}
      >
        Cobrar {formatearPesos(totales.total)} con {ETIQUETA_MEDIO_PAGO[medio].toLowerCase()}
      </Button>
    </div>
  );
}
