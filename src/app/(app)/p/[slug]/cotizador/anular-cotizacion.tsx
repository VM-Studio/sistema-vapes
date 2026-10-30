"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

import { anularCotizacionAction } from "./actions";

/**
 * Confirmación para anular una cotización (detalle y menú del listado). Queda
 * «Anulada»: no se edita, convierte ni acepta más. No toca stock.
 */
export function DialogoAnularCotizacion({
  id,
  codigo,
  open,
  onOpenChange,
}: {
  id: string;
  codigo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function anular() {
    setEnviando(true);
    const r = await anularCotizacionAction({
      id,
      ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
    }).catch(() => null);
    setEnviando(false);
    if (!r) return toast.error("Sin conexión", "La cotización no se anuló: probá de nuevo.");
    if (!r.ok) return toast.error("No se pudo anular", r.error.message);
    toast.success(`Cotización ${codigo} anulada`);
    onOpenChange(false);
    setMotivo("");
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !enviando && onOpenChange(o)}
      title={`¿Anular la cotización ${codigo}?`}
      description="Queda anulada: ya no se puede editar, aceptar ni convertir en venta. No se puede deshacer (si hace falta, duplicala)."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={enviando}>
            Volver
          </Button>
          <Button variant="danger" onClick={() => void anular()} loading={enviando}>
            Anular cotización
          </Button>
        </>
      }
    >
      <Input
        label="Motivo (opcional)"
        value={motivo}
        maxLength={500}
        onChange={(e) => setMotivo(e.target.value)}
      />
    </Dialog>
  );
}
