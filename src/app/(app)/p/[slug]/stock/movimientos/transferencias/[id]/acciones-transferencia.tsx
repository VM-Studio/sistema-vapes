"use client";

import { Ban, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";

import { anularTransferenciaAction, completarTransferenciaAction } from "../../actions";

export function AccionesTransferencia({
  id,
  numero,
  puedeCompletar,
  puedeAnular,
}: {
  id: string;
  numero: number;
  puedeCompletar: boolean;
  puedeAnular: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [completando, setCompletando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  if (!puedeCompletar && !puedeAnular) return null;

  async function completar() {
    const r = await completarTransferenciaAction({ id });
    setCompletando(false);
    if (!r.ok) return toast.error("No se pudo completar", r.error.message);
    invalidarResoluciones();
    toast.success(
      `Transferencia #${numero} completada`,
      `Se movieron ${r.data.unidades} unidades.`,
    );
    router.refresh();
  }

  async function anular() {
    setEnviando(true);
    const r = await anularTransferenciaAction({ id, motivo });
    setEnviando(false);
    if (!r.ok) {
      setErrorMotivo(r.error.fields?.motivo?.[0]);
      if (!r.error.fields?.motivo) toast.error("No se pudo anular", r.error.message);
      return;
    }
    setAnulando(false);
    toast.success(`Transferencia #${numero} anulada`);
    router.refresh();
  }

  return (
    <div className="flex w-full flex-col-reverse gap-2 md:w-auto md:flex-row md:justify-end">
      {puedeAnular && (
        <Button variant="secondary" onClick={() => setAnulando(true)}>
          <Ban strokeWidth={1.75} /> Anular
        </Button>
      )}
      {puedeCompletar && (
        <Button onClick={() => setCompletando(true)}>
          <Check strokeWidth={1.75} /> Completar transferencia
        </Button>
      )}

      <ConfirmDialog
        open={completando}
        onOpenChange={setCompletando}
        title={`¿Completar la transferencia #${numero}?`}
        description="Se descuenta el stock del origen y se suma en el destino. Si algún producto no alcanza, no se mueve nada y sigue pendiente."
        confirmLabel="Completar"
        onConfirm={completar}
      />
      <Dialog
        open={anulando}
        onOpenChange={setAnulando}
        title={`¿Anular la transferencia #${numero}?`}
        description="No mueve stock: solo la descarta."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAnulando(false)} disabled={enviando}>
              Volver
            </Button>
            <Button variant="danger" onClick={anular} loading={enviando}>
              Anular
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo"
          required
          rows={2}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errorMotivo}
        />
      </Dialog>
    </div>
  );
}
