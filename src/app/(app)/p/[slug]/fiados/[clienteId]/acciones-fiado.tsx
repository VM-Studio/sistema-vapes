"use client";

import type { MedioPago } from "@prisma/client";
import { Ban, CircleCheck, HandCoins, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { hoyAR } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { cn, formatearFecha } from "@/lib/utils";
import {
  ETIQUETA_MEDIO_PAGO,
  linkWhatsAppVenta,
  MEDIOS_PAGO,
  textoReciboCobro,
} from "@/lib/ventas-ui";
import type { CobroRegistrado, VentaPendiente } from "@/server/services/fiado.service";

import { ICONO_MEDIO_PAGO } from "../../ventas/_componentes/medio-pago";
import { aCentavos, montoTipeado } from "../../ventas/estado-venta";
import { anularCobroAction, registrarCobroAction } from "../actions";

/**
 * "Registrar cobro" (FIADOS "editar"): Sheet con monto (precargado con toda la
 * deuda), medio, referencia, fecha e imputación (de la más vieja a la más
 * nueva, o las ventas elegidas). Después: recibo por WhatsApp.
 */
export function RegistrarCobro({
  cliente,
  saldo,
  pendientes,
}: {
  cliente: { id: string; nombre: string; telefono: string };
  saldo: string;
  pendientes: VentaPendiente[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState(saldo);
  const [medio, setMedio] = useState<MedioPago | null>(null);
  const [referencia, setReferencia] = useState("");
  const [fecha, setFecha] = useState(() => hoyAR());
  const [elegir, setElegir] = useState(false);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<CobroRegistrado | null>(null);

  const montoValido = montoTipeado(monto);
  const tope = elegir
    ? pendientes
        .filter((v) => elegidas.includes(v.id))
        .reduce((a, v) => a + aCentavos(v.saldoPendiente), 0)
    : aCentavos(saldo);
  const excede = montoValido !== null && aCentavos(montoValido) > tope;
  const listo =
    montoValido !== null &&
    Number(montoValido) > 0 &&
    !excede &&
    medio !== null &&
    (!elegir || elegidas.length > 0);

  function abrir() {
    setMonto(saldo);
    setMedio(null);
    setReferencia("");
    setFecha(hoyAR());
    setElegir(false);
    setElegidas([]);
    setError(null);
    setHecho(null);
    setAbierto(true);
  }

  async function enviar() {
    if (!listo || !medio || montoValido === null) return;
    setEnviando(true);
    setError(null);
    const r = await registrarCobroAction({
      clienteId: cliente.id,
      monto: montoValido,
      medioPago: medio,
      referencia,
      fecha,
      ...(elegir ? { ventaIds: elegidas } : {}),
    }).catch(() => null);
    setEnviando(false);
    if (!r) {
      setError("Sin conexión con el servidor. El cobro NO se registró: probá de nuevo.");
      return;
    }
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setHecho(r.data);
    router.refresh();
  }

  const recibo = hecho
    ? linkWhatsAppVenta(
        hecho.cliente.telefono,
        textoReciboCobro({
          cliente: hecho.cliente.nombre,
          monto: hecho.monto,
          medio: hecho.medioPago,
          fecha: new Date(hecho.fecha),
          ventas: hecho.imputaciones.map((i) => ({ codigo: i.codigo, monto: i.monto })),
          saldoRestante: hecho.saldoRestante,
        }),
      )
    : null;

  return (
    <>
      <Button
        onClick={abrir}
        disabled={!(Number(saldo) > 0)}
        title={Number(saldo) > 0 ? undefined : "No debe nada"}
      >
        <HandCoins strokeWidth={1.75} /> Registrar cobro
      </Button>
      <Sheet
        open={abierto}
        onOpenChange={(o) => !enviando && setAbierto(o)}
        title={hecho ? "Cobro registrado" : `Cobro a ${cliente.nombre}`}
        description={hecho ? undefined : `Debe ${formatearPesos(saldo)}`}
        footer={
          hecho ? (
            <>
              <Button variant="secondary" onClick={() => setAbierto(false)}>
                Cerrar
              </Button>
              <a
                href={recibo ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants()}
                data-testid="recibo-whatsapp"
              >
                <MessageCircle strokeWidth={1.75} /> Enviar recibo por WhatsApp
              </a>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setAbierto(false)} disabled={enviando}>
                Cancelar
              </Button>
              <Button onClick={() => void enviar()} disabled={!listo} loading={enviando}>
                Registrar cobro
              </Button>
            </>
          )
        }
      >
        {hecho ? (
          <div className="flex flex-col items-center gap-4 py-2 text-center" role="status">
            <span className="bg-success-soft rounded-circle flex size-12 items-center justify-center">
              <CircleCheck className="text-success size-6" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="text-h2 font-semibold tabular-nums">{formatearPesos(hecho.monto)}</p>
              <p className="text-muted text-sm">
                {ETIQUETA_MEDIO_PAGO[hecho.medioPago]} · {formatearFecha(new Date(hecho.fecha))}
              </p>
            </div>
            <ul className="bg-surface rounded-card divide-border w-full divide-y text-left text-sm">
              {hecho.imputaciones.map((i) => (
                <li key={i.ventaId} className="flex justify-between gap-3 px-4 py-2.5">
                  <span className="font-mono font-semibold">{i.codigo}</span>
                  <span className="tabular-nums">
                    {formatearPesos(i.monto)}
                    <span className="text-muted">
                      {" "}
                      ·{" "}
                      {Number(i.saldoVenta) > 0
                        ? `debe ${formatearPesos(i.saldoVenta)}`
                        : "saldada"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm" data-testid="saldo-restante">
              {Number(hecho.saldoRestante) > 0 ? (
                <>
                  Saldo restante{" "}
                  <strong className="tabular-nums">{formatearPesos(hecho.saldoRestante)}</strong>
                </>
              ) : (
                <strong>La cuenta quedó al día</strong>
              )}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {error && (
              <p
                role="alert"
                className="bg-danger-soft text-danger-soft-foreground rounded-control px-4 py-3 text-sm"
              >
                {error}
              </p>
            )}
            <Input
              label="Monto"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              error={
                monto.trim() !== "" && montoValido === null
                  ? "Monto inválido"
                  : excede
                    ? `Máximo ${formatearPesos(tope / 100)}`
                    : undefined
              }
              className="text-h3 tabular-nums"
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="text-small mb-2 font-medium">Medio de pago</legend>
              <div role="radiogroup" aria-label="Medio de pago" className="grid grid-cols-3 gap-2">
                {MEDIOS_PAGO.map((m) => {
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
                        "rounded-control flex min-h-16 flex-col items-center justify-center gap-1 border px-2 text-sm font-semibold transition-colors",
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Referencia (opcional)"
                maxLength={100}
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
              <Input
                label="Fecha"
                type="date"
                max={hoyAR()}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <fieldset className="flex flex-col">
              <legend className="text-small mb-1 font-medium">Imputar a</legend>
              <Radio
                name="imputar"
                label="De la venta más vieja a la más nueva"
                checked={!elegir}
                onChange={() => setElegir(false)}
              />
              <Radio
                name="imputar"
                label="Elegir ventas"
                checked={elegir}
                onChange={() => setElegir(true)}
              />
              {elegir && (
                <ul className="bg-surface rounded-card mt-1 flex flex-col px-3 py-1">
                  {pendientes.map((v) => (
                    <li key={v.id}>
                      <Checkbox
                        label={
                          <span className="flex w-full justify-between gap-3">
                            <span>
                              <span className="font-mono font-semibold">{v.codigo}</span>{" "}
                              <span className="text-muted">{formatearFecha(v.fecha)}</span>
                            </span>
                            <span className="tabular-nums">{formatearPesos(v.saldoPendiente)}</span>
                          </span>
                        }
                        checked={elegidas.includes(v.id)}
                        onChange={(e) =>
                          setElegidas((l) =>
                            e.target.checked ? [...l, v.id] : l.filter((x) => x !== v.id),
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          </div>
        )}
      </Sheet>
    </>
  );
}

/** Anular un cobro (solo dueños, motivo obligatorio): lo cobrado vuelve a deberse. */
export function AnularCobro({ pagoId, monto }: { pagoId: string; monto: string }) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (motivo.trim().length < 3) {
      setError("Contá brevemente por qué se anula");
      return;
    }
    setEnviando(true);
    const r = await anularCobroAction({ pagoId, motivo });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.motivo?.[0]);
      if (!r.error.fields?.motivo) toast.error("No se pudo anular", r.error.message);
      return;
    }
    toast.success("Cobro anulado", `${formatearPesos(r.data.monto)} vuelven a deberse.`);
    setAbierto(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setAbierto(true)}>
        <Ban strokeWidth={1.75} /> Anular
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={(o) => !enviando && setAbierto(o)}
        title="¿Anular el cobro?"
        description={`Los ${formatearPesos(monto)} vuelven a la deuda del cliente. No se puede deshacer.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={enviando}>
              Volver
            </Button>
            <Button variant="danger" onClick={() => void enviar()} loading={enviando}>
              Anular cobro
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo"
          required
          rows={2}
          value={motivo}
          onChange={(e) => {
            setMotivo(e.target.value);
            setError(undefined);
          }}
          error={error}
        />
      </Dialog>
    </>
  );
}
