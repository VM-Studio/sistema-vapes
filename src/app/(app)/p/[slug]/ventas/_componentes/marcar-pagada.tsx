"use client";

import type { MedioPago } from "@prisma/client";
import { HandCoins } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";

import { marcarPagadaAction } from "../actions";
import { aCentavos, montoTipeado } from "../estado-venta";
import { ICONO_MEDIO_PAGO } from "./medio-pago";

/**
 * «Marcar pagada» de una venta con saldo (detalle y listado de Ventas): medio
 * (los del panel), monto (todo el saldo por defecto; se puede cobrar una parte)
 * y referencia opcional. Registra un cobro de cuenta corriente imputado a esta
 * venta. VENTAS "editar" o FIADOS "editar".
 */
export function MarcarPagada({
  venta,
  medios,
  size = "md",
}: {
  venta: { id: string; codigo: string; saldoPendiente: string };
  medios: readonly MedioPago[];
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState(venta.saldoPendiente);
  const [medio, setMedio] = useState<MedioPago | null>(null);
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const montoValido = montoTipeado(monto);
  const excede = montoValido !== null && aCentavos(montoValido) > aCentavos(venta.saldoPendiente);
  const listo = montoValido !== null && Number(montoValido) > 0 && !excede && medio !== null;

  function abrir() {
    setMonto(venta.saldoPendiente);
    setMedio(medios.length === 1 ? medios[0]! : null);
    setReferencia("");
    setError(null);
    setAbierto(true);
  }

  async function enviar() {
    if (!listo || !medio || montoValido === null) return;
    setEnviando(true);
    setError(null);
    const r = await marcarPagadaAction({
      ventaId: venta.id,
      monto: montoValido,
      medioPago: medio,
      referencia,
    }).catch(() => null);
    setEnviando(false);
    if (!r)
      return setError("Sin conexión con el servidor. El pago NO se registró: probá de nuevo.");
    if (!r.ok) return setError(r.error.message);
    setAbierto(false);
    toast.success(
      r.data.estadoPago === "PAGADA"
        ? `Venta ${venta.codigo} pagada`
        : `Pago parcial en ${venta.codigo}`,
      r.data.estadoPago === "PAGADA"
        ? `${formatearPesos(r.data.monto)} con ${ETIQUETA_MEDIO_PAGO[r.data.medioPago]}.`
        : `${formatearPesos(r.data.monto)} con ${ETIQUETA_MEDIO_PAGO[r.data.medioPago]} · debe ${formatearPesos(r.data.saldoVenta)}.`,
    );
    router.refresh();
  }

  return (
    <>
      <Button size={size} onClick={abrir} data-testid={`marcar-pagada-${venta.codigo}`}>
        <HandCoins strokeWidth={1.75} /> Marcar pagada
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={(o) => !enviando && setAbierto(o)}
        title={`Pago de ${venta.codigo}`}
        description={`Pendiente: ${formatearPesos(venta.saldoPendiente)}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={enviando}>
              Volver
            </Button>
            <Button onClick={() => void enviar()} disabled={!listo} loading={enviando}>
              Registrar pago
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-small mb-2 font-medium">¿Cómo pagó?</legend>
            <div
              role="radiogroup"
              aria-label="Medio de pago"
              className={cn("grid gap-2", medios.length >= 4 ? "grid-cols-2" : "grid-cols-3")}
            >
              {medios.map((m) => {
                const Icono = ICONO_MEDIO_PAGO[m];
                const activo = medio === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={activo}
                    onClick={() => setMedio(m)}
                    className={cn(
                      "rounded-control flex min-h-14 flex-col items-center justify-center gap-1 border px-2 text-sm font-semibold transition-colors",
                      activo
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground bg-surface text-foreground hover:bg-surface-2",
                    )}
                  >
                    <Icono
                      className={cn("size-5", activo ? "text-background" : "text-muted")}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {ETIQUETA_MEDIO_PAGO[m]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Input
            label="Monto"
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            hint="Todo el saldo, o una parte si pagó una seña."
            error={
              monto.trim() !== "" && montoValido === null
                ? "Monto inválido"
                : excede
                  ? `Máximo ${formatearPesos(venta.saldoPendiente)}`
                  : undefined
            }
            className="tabular-nums"
          />
          <Input
            label="Referencia (opcional)"
            maxLength={100}
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
          />
          {error && (
            <p
              role="alert"
              className="bg-danger-soft text-danger-soft-foreground rounded-control px-3 py-2 text-sm"
            >
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
