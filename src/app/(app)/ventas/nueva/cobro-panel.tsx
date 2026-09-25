"use client";

import { MedioPago } from "@prisma/client";
import { HandCoins, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClientePos } from "@/server/services/cliente.service";

import { centavos, CON_REFERENCIA, ETIQUETA_MEDIO, num, type DescuentoGlobal } from "./tipos";

export interface FilaPago {
  id: number;
  medioPago: MedioPago;
  /** Efectivo: lo que entrega el cliente (puede superar lo que falta: hay vuelto). */
  monto: string;
  referencia: string;
}

export interface PagoAEnviar {
  medioPago: MedioPago;
  monto: number;
  referencia?: string;
}

let secuencia = 0;
const soloDecimal = (s: string) => s.replace(/[^\d.,]/g, "");

/**
 * Cobro: descuento (con permiso), redondeo, pagos partidos, vuelto y fiado.
 * Solo calcula para mostrar: el servidor recalcula todo y rechaza pagos de más.
 */
export function CobroPanel({
  totales,
  redondeoConfig,
  redondear,
  onRedondear,
  descuento,
  onDescuento,
  puedeEditar,
  cliente,
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
  cliente: ClientePos | null;
  enviando: boolean;
  onConfirmar: (pagos: PagoAEnviar[], meta: { fiado: boolean; vuelto: number }) => void;
  autoFocus?: boolean;
}) {
  const [filas, setFilas] = useState<FilaPago[]>(() => [
    {
      id: ++secuencia,
      medioPago: MedioPago.EFECTIVO,
      monto: totales.total ? String(totales.total) : "",
      referencia: "",
    },
  ]);
  const tocado = useRef(false);
  const primerMonto = useRef<HTMLInputElement>(null);

  // Mientras no se tocó, el único pago sigue al total (cambios en el carrito o el descuento).
  useEffect(() => {
    if (!tocado.current)
      setFilas((f) =>
        f.length === 1 ? [{ ...f[0]!, monto: totales.total ? String(totales.total) : "" }] : f,
      );
  }, [totales.total]);
  useEffect(() => {
    if (autoFocus) primerMonto.current?.select();
  }, [autoFocus]);

  const totalC = centavos(totales.total);
  const noEfectivoC = filas
    .filter((f) => f.medioPago !== MedioPago.EFECTIVO)
    .reduce((a, f) => a + centavos(num(f.monto)), 0);
  const efectivoRecibidoC = filas
    .filter((f) => f.medioPago === MedioPago.EFECTIVO)
    .reduce((a, f) => a + centavos(num(f.monto)), 0);
  const efectivoAplicadoC = Math.max(0, Math.min(efectivoRecibidoC, totalC - noEfectivoC));
  const vueltoC = efectivoRecibidoC - efectivoAplicadoC;
  const restanteC = totalC - noEfectivoC - efectivoAplicadoC;
  const excedidoC = noEfectivoC - totalC; // > 0: tarjeta/transferencia de más (no hay vuelto posible)
  const saldoAFavorC = centavos(num(cliente?.saldoAFavor));
  const usoSaldoC = filas
    .filter((f) => f.medioPago === MedioPago.CREDITO_CLIENTE)
    .reduce((a, f) => a + centavos(num(f.monto)), 0);
  const limite = cliente?.limiteCredito ? centavos(num(cliente.limiteCredito)) : null;
  const deudaC = centavos(num(cliente?.saldoDeudor));
  const puedeFiar = puedeEditar && cliente !== null && limite !== null;
  const fiadoDentroDelLimite = limite !== null && deudaC + restanteC <= limite;
  const hayEfectivo = filas.some((f) => f.medioPago === MedioPago.EFECTIVO);

  const medios = Object.values(MedioPago).filter(
    (m) =>
      m !== MedioPago.CREDITO_CLIENTE || saldoAFavorC > 0 || filas.some((f) => f.medioPago === m),
  );

  function cambiar(id: number, cambios: Partial<FilaPago>) {
    tocado.current = true;
    setFilas((f) => f.map((x) => (x.id === id ? { ...x, ...cambios } : x)));
  }
  function agregar() {
    tocado.current = true;
    const usado = new Set(filas.map((f) => f.medioPago));
    const medio =
      (
        [
          MedioPago.TRANSFERENCIA,
          MedioPago.DEBITO,
          MedioPago.MERCADOPAGO,
          MedioPago.CREDITO,
        ] as MedioPago[]
      ).find((m) => !usado.has(m)) ?? MedioPago.OTRO;
    setFilas((f) => [
      ...f,
      {
        id: ++secuencia,
        medioPago: medio,
        monto: restanteC > 0 ? String(restanteC / 100) : "",
        referencia: "",
      },
    ]);
  }

  function pagosAEnviar(): PagoAEnviar[] {
    const pagos: PagoAEnviar[] = filas
      .filter((f) => f.medioPago !== MedioPago.EFECTIVO && num(f.monto) > 0)
      .map((f) => ({
        medioPago: f.medioPago,
        monto: num(f.monto),
        ...(f.referencia.trim() ? { referencia: f.referencia.trim() } : {}),
      }));
    if (efectivoAplicadoC > 0)
      pagos.unshift({ medioPago: MedioPago.EFECTIVO, monto: efectivoAplicadoC / 100 });
    return pagos;
  }

  const errorSaldo =
    usoSaldoC > saldoAFavorC
      ? `El cliente tiene ${formatearPesos(saldoAFavorC / 100)} a favor`
      : null;
  const puedeConfirmar =
    totalC >= 0 && restanteC === 0 && excedidoC <= 0 && !errorSaldo && !enviando;

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

      {/* Pagos */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Pagos</legend>
        {filas.map((f, i) => (
          <div key={f.id} className="border-border flex flex-col gap-2 rounded-xl border p-2.5">
            <div className="flex gap-2">
              <select
                aria-label={`Medio de pago ${i + 1}`}
                className={cn(controlClass, "h-11 min-w-0 flex-1")}
                value={f.medioPago}
                onChange={(e) => cambiar(f.id, { medioPago: e.target.value as MedioPago })}
              >
                {medios.map((m) => (
                  <option
                    key={m}
                    value={m}
                    disabled={
                      m === MedioPago.EFECTIVO && hayEfectivo && f.medioPago !== MedioPago.EFECTIVO
                    }
                  >
                    {ETIQUETA_MEDIO[m]}
                  </option>
                ))}
              </select>
              <input
                ref={i === 0 ? primerMonto : undefined}
                inputMode="decimal"
                aria-label={
                  f.medioPago === MedioPago.EFECTIVO
                    ? "Efectivo recibido"
                    : `Monto ${ETIQUETA_MEDIO[f.medioPago]}`
                }
                className={cn(
                  controlClass,
                  "h-11 w-32 text-right text-base font-semibold tabular-nums",
                )}
                value={f.monto}
                onChange={(e) => cambiar(f.id, { monto: soloDecimal(e.target.value) })}
              />
              {filas.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-danger size-11 shrink-0"
                  onClick={() => setFilas((x) => x.filter((y) => y.id !== f.id))}
                  aria-label={`Quitar pago ${i + 1}`}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            {CON_REFERENCIA.has(f.medioPago) && (
              <input
                aria-label={`Referencia ${ETIQUETA_MEDIO[f.medioPago]}`}
                placeholder="N.º de operación (opcional)"
                className={cn(controlClass, "h-10")}
                value={f.referencia}
                onChange={(e) => cambiar(f.id, { referencia: e.target.value })}
              />
            )}
            {f.medioPago === MedioPago.CREDITO_CLIENTE && (
              <p className="text-muted text-xs">Disponible: {formatearPesos(saldoAFavorC / 100)}</p>
            )}
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={agregar}
          disabled={filas.length >= 6}
        >
          <Plus /> Agregar medio de pago
        </Button>
      </fieldset>

      {/* Estado del cobro */}
      <div aria-live="polite" className="flex flex-col gap-1 text-sm">
        {vueltoC > 0 && (
          <p className="bg-success-soft text-success-soft-foreground flex items-center justify-between rounded-lg px-3 py-2 text-base font-semibold">
            <span>Vuelto</span>
            <span className="tabular-nums" data-testid="vuelto">
              {formatearPesos(vueltoC / 100)}
            </span>
          </p>
        )}
        {restanteC > 0 && (
          <p className="bg-warning-soft text-warning-soft-foreground flex justify-between rounded-lg px-3 py-2 font-medium">
            <span>Falta cobrar</span>
            <span className="tabular-nums">{formatearPesos(restanteC / 100)}</span>
          </p>
        )}
        {excedidoC > 0 && (
          <p className="text-danger">
            Los pagos con tarjeta/transferencia superan el total en{" "}
            {formatearPesos(excedidoC / 100)}.
          </p>
        )}
        {errorSaldo && <p className="text-danger">{errorSaldo}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          fullWidth
          onClick={() => onConfirmar(pagosAEnviar(), { fiado: false, vuelto: vueltoC / 100 })}
          disabled={!puedeConfirmar}
          loading={enviando}
        >
          Confirmar venta
        </Button>
        {puedeFiar && restanteC > 0 && excedidoC <= 0 && (
          <>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => onConfirmar(pagosAEnviar(), { fiado: true, vuelto: 0 })}
              disabled={!fiadoDentroDelLimite || enviando || Boolean(errorSaldo)}
            >
              <HandCoins /> Vender fiado ({formatearPesos(restanteC / 100)} a cuenta)
            </Button>
            <p className={cn("text-xs", fiadoDentroDelLimite ? "text-muted" : "text-danger")}>
              {cliente?.nombre} debe {formatearPesos(deudaC / 100)} · límite{" "}
              {formatearPesos((limite ?? 0) / 100)}
              {!fiadoDentroDelLimite && " — esta venta lo supera"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
