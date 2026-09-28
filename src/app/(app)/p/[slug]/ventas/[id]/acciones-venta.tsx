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

/** Anular una venta confirmada (solo dueños, motivo obligatorio): el stock vuelve al galpón. */
export function AnularVenta({
  venta,
  bloqueada,
}: {
  venta: { id: string; codigo: string; total: string };
  /** Tiene devoluciones registradas: primero hay que anularlas. */
  bloqueada: boolean;
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
    const r = await anularVentaAction({ ventaId: venta.id, motivo });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.motivo?.[0]);
      if (!r.error.fields?.motivo) toast.error("No se pudo anular", r.error.message);
      return;
    }
    toast.success(`Venta ${venta.codigo} anulada`, "El stock volvió al galpón.");
    setAbierto(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="secondary"
        className="text-danger"
        disabled={bloqueada}
        title={bloqueada ? "Tiene devoluciones registradas: anulalas primero" : undefined}
        onClick={() => setAbierto(true)}
      >
        <Ban strokeWidth={1.75} /> Anular venta
      </Button>
      {bloqueada && (
        <p className="text-muted text-xs">
          Tiene devoluciones registradas: para anularla, primero anulá las devoluciones.
        </p>
      )}
      <Dialog
        open={abierto}
        onOpenChange={(o) => !enviando && setAbierto(o)}
        title={`¿Anular la venta ${venta.codigo}?`}
        description={`Vuelve todo el stock al galpón. Si ya cobraste ${formatearPesos(venta.total)}, devolvéselo al cliente. No se puede deshacer.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={enviando}>
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
    </>
  );
}
