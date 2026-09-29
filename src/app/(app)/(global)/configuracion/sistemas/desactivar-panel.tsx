"use client";

import { Power } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

import { desactivarPanelAction } from "../../paneles/actions";

export function DesactivarPanel({ panelId, nombre }: { panelId: string; nombre: string }) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);

  async function confirmar() {
    const r = await desactivarPanelAction(panelId);
    if (!r.ok) return toast.error("No se pudo desactivar", r.error.message);
    setAbierto(false);
    toast.success(`${nombre} desactivado`, "Ya no aparece en el selector. Sus datos se conservan.");
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setAbierto(true)} className="w-full sm:w-auto">
        <Power strokeWidth={1.75} /> Desactivar
      </Button>
      <ConfirmDialog
        open={abierto}
        onOpenChange={setAbierto}
        title={`¿Desactivar ${nombre}?`}
        description="Deja de aparecer y nadie puede entrar. Sus productos, ventas y stock se conservan (no se borra nada)."
        confirmLabel="Desactivar"
        danger
        onConfirm={confirmar}
      />
    </>
  );
}
