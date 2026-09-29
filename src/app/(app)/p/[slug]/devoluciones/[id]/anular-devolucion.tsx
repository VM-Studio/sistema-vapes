"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";

import { anularDevolucionAction } from "../actions";

/** Solo dueños: anula la devolución y repone la unidad al stock del galpón. */
export function AnularDevolucion({ id, codigo }: { id: string; codigo: string }) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function anular() {
    setEnviando(true);
    setError(null);
    const r = await anularDevolucionAction({ id, motivo });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.motivo?.[0] ?? r.error.message);
      return;
    }
    invalidarResoluciones();
    setAbierto(false);
    toast.success(`Devolución ${codigo} anulada`, "La unidad volvió al stock.");
    router.refresh();
  }

  return (
    <>
      <Button variant="danger" onClick={() => setAbierto(true)}>
        <Ban strokeWidth={1.75} /> Anular
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={(o) => !enviando && setAbierto(o)}
        title={`¿Anular la devolución ${codigo}?`}
        description="La unidad entregada vuelve al stock del galpón. No se puede deshacer."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => void anular()}
              loading={enviando}
              disabled={motivo.trim().length < 5}
            >
              Anular devolución
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
          maxLength={500}
          error={error ?? undefined}
          hint="Mínimo 5 caracteres."
        />
      </Dialog>
    </>
  );
}
