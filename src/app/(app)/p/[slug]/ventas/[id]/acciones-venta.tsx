"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";

import { anularVentaAction } from "../actions";

/**
 * Anular una venta confirmada (dueños o VENTAS "eliminar", motivo obligatorio): el
 * stock vuelve al galpón (VENTA_ANULADA) y sus pagos se anulan. Sirve en el detalle
 * y en el menú de cada fila del listado (`abierto`/`onAbiertoChange` sin botón propio).
 */
export function AnularVenta({
  venta,
  bloqueada,
}: {
  /** montoPagado: lo cobrado (al vender y cobros de fiado); saldoPendiente: lo que se fió. */
  venta: VentaAnulable;
  /** Tiene devoluciones registradas: primero hay que anularlas. */
  bloqueada: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button
        variant="danger"
        disabled={bloqueada}
        title={bloqueada ? "Tiene devoluciones registradas: anulalas primero" : undefined}
        onClick={() => setAbierto(true)}
      >
        <Ban strokeWidth={1.75} /> Anular venta
      </Button>
      <DialogoAnularVenta venta={venta} open={abierto} onOpenChange={setAbierto} />
    </>
  );
}

export interface VentaAnulable {
  id: string;
  codigo: string;
  montoPagado: string;
  saldoPendiente: string;
}

/** Confirmación con motivo (la usan el botón del detalle y el menú de la fila del listado). */
export function DialogoAnularVenta({
  venta,
  open,
  onOpenChange,
}: {
  venta: VentaAnulable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (motivo.trim().length < 3) {
      setError("Contá brevemente por qué se anula");
      return;
    }
    setEnviando(true);
    const r = await anularVentaAction({ ventaId: venta.id, motivo }).catch(() => null);
    setEnviando(false);
    if (!r) {
      toast.error("Sin conexión", "La venta no se anuló: probá de nuevo.");
      return;
    }
    if (!r.ok) {
      setError(r.error.fields?.motivo?.[0]);
      if (!r.error.fields?.motivo) toast.error("No se pudo anular", r.error.message);
      return;
    }
    toast.success(`Venta ${venta.codigo} anulada`, "El stock volvió al galpón.");
    setMotivo("");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !enviando && onOpenChange(o)}
      title={`¿Anular la venta ${venta.codigo}?`}
      description={[
        "Vuelve todo el stock al galpón y se anulan sus pagos.",
        Number(venta.montoPagado) > 0 &&
          `Si ya cobraste ${formatearPesos(venta.montoPagado)}, devolvéselo al cliente.`,
        Number(venta.saldoPendiente) > 0 &&
          `Se descuentan ${formatearPesos(venta.saldoPendiente)} de su cuenta corriente.`,
        "No se puede deshacer.",
      ]
        .filter(Boolean)
        .join(" ")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={enviando}>
            Volver
          </Button>
          <Button variant="danger" onClick={() => void enviar()} loading={enviando}>
            Anular venta
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
  );
}
