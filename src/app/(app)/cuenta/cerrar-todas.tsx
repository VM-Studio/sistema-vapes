"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { borrarCatalogo } from "@/features/offline/catalogo";

import { cerrarTodasLasSesionesAction } from "./actions";

export function CerrarTodas() {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setAbierto(true)} className="w-full md:w-fit">
        <LogOut /> Cerrar sesión en todos los dispositivos
      </Button>
      <ConfirmDialog
        open={abierto}
        onOpenChange={setAbierto}
        title="¿Cerrar sesión en todos los dispositivos?"
        description="Incluido este. Si perdiste el celular o alguien vio tu contraseña, hacé esto y después cambiala."
        confirmLabel="Cerrar todas"
        danger
        onConfirm={async () => {
          const r = await cerrarTodasLasSesionesAction();
          if (!r.ok) return toast.error("No se pudo", r.error.message);
          await borrarCatalogo();
          window.location.assign("/login");
        }}
      />
    </>
  );
}
