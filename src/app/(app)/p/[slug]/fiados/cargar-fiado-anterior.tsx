"use client";

import { Ban, History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SelectorCliente, type ClienteElegido } from "@/components/clientes/selector-cliente";
import { usePanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { hoyAR } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";

import { montoTipeado } from "../ventas/estado-venta";
import { anularFiadoAnteriorAction, cargarFiadoAnteriorAction } from "./actions";

/**
 * «Cargar fiado anterior» (FIADOS "crear"): lo que un cliente ya debía antes
 * de usar el sistema. Cliente (existente o nuevo), cuánto debe en pesos,
 * desde cuándo y qué debe. No es una venta: no toca stock ni ganancias, solo
 * suma a su deuda y después se cobra como cualquier fiado.
 * Con `cliente` (desde la cuenta corriente) el cliente ya viene elegido.
 */
export function CargarFiadoAnterior({
  cliente: fijo,
  variante = "secondary",
}: {
  cliente?: { id: string; nombre: string; telefono: string };
  variante?: "primary" | "secondary";
}) {
  const router = useRouter();
  const panel = usePanel();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [cliente, setCliente] = useState<ClienteElegido | null>(null);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(() => hoyAR());
  const [concepto, setConcepto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const elegido: ClienteElegido | null = fijo ? { tipo: "existente", ...fijo } : cliente;
  const montoValido = montoTipeado(monto);
  const listo = elegido !== null && montoValido !== null && Number(montoValido) > 0;

  function abrir() {
    setCliente(null);
    setMonto("");
    setFecha(hoyAR());
    setConcepto("");
    setError(null);
    setAbierto(true);
  }

  async function enviar() {
    if (!listo || !elegido || montoValido === null) return;
    setEnviando(true);
    setError(null);
    const r = await cargarFiadoAnteriorAction({
      cliente:
        elegido.tipo === "existente"
          ? { id: elegido.id }
          : {
              nuevo: {
                nombre: elegido.nombre,
                telefono: elegido.telefono,
                origenId: elegido.origenId,
              },
            },
      monto: montoValido,
      fecha,
      concepto,
    }).catch(() => null);
    setEnviando(false);
    if (!r) {
      setError("Sin conexión con el servidor. El fiado NO se cargó: probá de nuevo.");
      return;
    }
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    toast.success(
      "Fiado cargado",
      `${r.data.cliente.nombre} debe ${formatearPesos(r.data.monto)} más (${r.data.codigo}).`,
    );
    setAbierto(false);
    if (fijo) router.refresh();
    else router.push(rutaPanel(panel.slug, `/fiados/${r.data.cliente.id}`));
  }

  return (
    <>
      <Button variant={variante} onClick={abrir} data-testid="cargar-fiado-anterior">
        <History strokeWidth={1.75} /> Cargar fiado anterior
      </Button>
      <Sheet
        open={abierto}
        onOpenChange={(o) => !enviando && setAbierto(o)}
        title="Cargar fiado anterior"
        description="Lo que alguien ya debía antes de usar el sistema. No es una venta: no toca el stock ni las ganancias, solo suma a su cuenta."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={() => void enviar()} disabled={!listo} loading={enviando}>
              Cargar fiado
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {error && (
            <p
              role="alert"
              className="bg-danger-soft text-danger-soft-foreground rounded-control px-4 py-3 text-sm"
            >
              {error}
            </p>
          )}
          {fijo ? (
            <p className="bg-surface rounded-card px-4 py-3 text-sm">
              Cliente: <strong>{fijo.nombre}</strong>
            </p>
          ) : (
            <SelectorCliente valor={cliente} onCambiar={setCliente} />
          )}
          <Input
            label="¿Cuánto debe? (en pesos)"
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            error={monto.trim() !== "" && montoValido === null ? "Monto inválido" : undefined}
            className="text-h3 tabular-nums"
            data-testid="monto-fiado-anterior"
          />
          <Input
            label="¿Desde cuándo debe?"
            type="date"
            max={hoyAR()}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            hint="Si no te acordás, dejá la fecha de hoy."
          />
          <Input
            label="¿Qué debe? (opcional)"
            maxLength={200}
            placeholder="Ej.: 3 vapes de agosto, cuenta vieja…"
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
          />
        </div>
      </Sheet>
    </>
  );
}

/** Anular un fiado anterior cargado por error (solo dueños; sin cobros vigentes). */
export function AnularFiadoAnterior({
  fiadoId,
  codigo,
  monto,
}: {
  fiadoId: string;
  codigo: string;
  monto: string;
}) {
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
    const r = await anularFiadoAnteriorAction({ fiadoId, motivo });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.motivo?.[0]);
      if (!r.error.fields?.motivo) toast.error("No se pudo anular", r.error.message);
      return;
    }
    toast.success("Fiado anulado", `${codigo} ya no suma a la deuda.`);
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
        title={`¿Anular el fiado ${codigo}?`}
        description={`Los ${formatearPesos(monto)} dejan de deberse. No se puede deshacer (si hace falta, cargalo de nuevo).`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={enviando}>
              Volver
            </Button>
            <Button variant="danger" onClick={() => void enviar()} loading={enviando}>
              Anular fiado
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
