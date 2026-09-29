"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

import { revocarSesionesAction } from "../actions";

export function CerrarSesiones({
  usuarioId,
  nombre,
  cantidad,
}: {
  usuarioId: string;
  nombre: string;
  cantidad: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);

  async function confirmar() {
    const r = await revocarSesionesAction({ id: usuarioId });
    if (!r.ok) return toast.error("No se pudieron cerrar las sesiones", r.error.message);
    setAbierto(false);
    toast.success(
      `Sesiones de ${nombre} cerradas`,
      `${r.data.revocadas} dispositivo(s): tiene que volver a ingresar.`,
    );
    router.refresh();
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setAbierto(true)}
        disabled={cantidad === 0}
        className="w-full"
      >
        <LogOut strokeWidth={1.75} /> Cerrar sesiones
      </Button>
      <ConfirmDialog
        open={abierto}
        onOpenChange={setAbierto}
        title={`¿Cerrar las sesiones de ${nombre}?`}
        description="Se cierra en todos sus dispositivos (celular, computadora). Puede volver a ingresar con su contraseña."
        confirmLabel="Cerrar sesiones"
        onConfirm={confirmar}
      />
    </>
  );
}
