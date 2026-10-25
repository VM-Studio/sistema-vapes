"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

import { resetearPasswordAction } from "../actions";

/**
 * Camino de los dueños: contraseña temporal para otro usuario (se ve una sola
 * vez; al ingresar la tiene que cambiar, con el código por mail). Sirve
 * también cuando a alguien no le llega el mail con el código.
 */
export function ResetearPassword({ usuarioId, nombre }: { usuarioId: string; nombre: string }) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [temporal, setTemporal] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function confirmar() {
    const r = await resetearPasswordAction({ id: usuarioId });
    if (!r.ok) return toast.error("No se pudo resetear", r.error.message);
    setAbierto(false);
    setCopiado(false);
    setTemporal(r.data.passwordTemporal);
    router.refresh();
  }

  async function copiar() {
    if (!temporal) return;
    await navigator.clipboard.writeText(temporal);
    setCopiado(true);
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setAbierto(true)} className="w-full">
        <KeyRound strokeWidth={1.75} /> Resetear contraseña
      </Button>
      <ConfirmDialog
        open={abierto}
        onOpenChange={setAbierto}
        title={`¿Resetear la contraseña de ${nombre}?`}
        description="Se genera una contraseña temporal que vas a ver una sola vez y se cierran sus sesiones. Al ingresar la va a tener que cambiar."
        confirmLabel="Resetear"
        onConfirm={confirmar}
      />
      <Dialog
        open={temporal !== null}
        onOpenChange={(o) => !o && setTemporal(null)}
        title="Contraseña temporal"
        description={
          <>
            Pasale esta contraseña a <strong>{nombre}</strong>.{" "}
            <strong>No se va a volver a mostrar.</strong>
          </>
        }
        footer={
          <Button onClick={() => setTemporal(null)} fullWidth>
            Listo, ya la copié
          </Button>
        }
      >
        <div className="border-border bg-surface rounded-control flex items-center gap-2 border p-2 pl-4">
          <code
            className="text-h3 flex-1 font-mono font-semibold tracking-wider break-all select-all"
            data-testid="password-temporal"
          >
            {temporal}
          </code>
          <Button variant="secondary" size="icon" onClick={copiar} aria-label="Copiar contraseña">
            {copiado ? <Check strokeWidth={1.75} /> : <Copy strokeWidth={1.75} />}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
