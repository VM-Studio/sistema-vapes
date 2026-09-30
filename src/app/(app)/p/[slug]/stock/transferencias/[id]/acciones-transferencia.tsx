"use client";

import { Ban, FileText, MessageCircle, PackageCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { abrirEnPestana } from "@/app/(app)/p/[slug]/cotizador/compartir";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { linkWhatsAppTexto } from "@/lib/movimientos-ui";

import {
  anularTransferenciaAction,
  completarTransferenciaAction,
  remitoTransferenciaAction,
} from "../actions";

export function AccionesTransferencia({
  id,
  codigo,
  pendiente,
  remitoUrl,
  whatsapp,
  puedeCompletar,
  puedeAnular,
}: {
  id: string;
  codigo: string;
  pendiente: boolean;
  remitoUrl: string | null;
  whatsapp: string;
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
  const [generando, setGenerando] = useState(false);

  async function completar() {
    const r = await completarTransferenciaAction({ id });
    setCompletando(false);
    if (!r.ok) return toast.error("No se pudo confirmar la recepción", r.error.message);
    invalidarResoluciones();
    toast.success(`Transferencia ${codigo} recibida`, `Se movieron ${r.data.unidades} unidades.`);
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
    toast.success(`Transferencia ${codigo} anulada`);
    router.refresh();
  }

  async function verRemito() {
    setGenerando(true);
    const error = await abrirEnPestana(() => remitoTransferenciaAction({ id }));
    setGenerando(false);
    if (error) toast.error("No se pudo generar el remito", error);
    else router.refresh();
  }

  return (
    <div className="flex w-full flex-col-reverse gap-2 md:w-auto md:flex-row md:justify-end">
      {puedeAnular && (
        <Button variant="ghost" onClick={() => setAnulando(true)}>
          <Ban strokeWidth={1.75} /> Anular
        </Button>
      )}
      <a
        href={linkWhatsAppTexto(whatsapp)}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ variant: "secondary" })}
      >
        <MessageCircle strokeWidth={1.75} /> WhatsApp
      </a>
      {remitoUrl ? (
        <a
          href={remitoUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="remito-transferencia"
          className={buttonVariants({ variant: "secondary" })}
        >
          <FileText strokeWidth={1.75} /> Ver remito (PDF)
        </a>
      ) : (
        <Button variant="secondary" onClick={() => void verRemito()} loading={generando}>
          {!generando && <FileText strokeWidth={1.75} />} Generar remito (PDF)
        </Button>
      )}
      {puedeCompletar && (
        <Button onClick={() => setCompletando(true)}>
          <PackageCheck strokeWidth={1.75} /> Confirmar recepción
        </Button>
      )}

      <ConfirmDialog
        open={completando}
        onOpenChange={setCompletando}
        title={`¿Confirmar la recepción de ${codigo}?`}
        description="Se descuenta el stock del origen y se suma en el destino. Si algún producto no alcanza, no se mueve nada y sigue pendiente."
        confirmLabel="Confirmar recepción"
        onConfirm={completar}
      />
      {pendiente && (
        <Dialog
          open={anulando}
          onOpenChange={setAnulando}
          title={`¿Anular la transferencia ${codigo}?`}
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
      )}
    </div>
  );
}
