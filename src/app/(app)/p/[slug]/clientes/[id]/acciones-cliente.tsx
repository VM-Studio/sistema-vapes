"use client";

import { Pencil, UserCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClienteForm, type ClienteEditable } from "@/components/clientes/cliente-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

import { desactivarClienteAction, reactivarClienteAction } from "../actions";

export function AccionesCliente({
  cliente,
  activo,
  puedeEditar,
  puedeEliminar,
}: {
  cliente: ClienteEditable;
  activo: boolean;
  puedeEditar: boolean;
  puedeEliminar: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState<"editar" | "baja" | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function desactivar() {
    const r = await desactivarClienteAction({ id: cliente.id });
    setAbierto(null);
    if (!r.ok) return toast.error("No se pudo desactivar", r.error.message);
    toast.success(`${cliente.nombre} desactivado`);
    router.refresh();
  }

  async function reactivar() {
    const r = await reactivarClienteAction({ id: cliente.id });
    if (!r.ok) return toast.error("No se pudo reactivar", r.error.message);
    toast.success(`${cliente.nombre} reactivado`);
    router.refresh();
  }

  if (!puedeEditar && !puedeEliminar) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {puedeEditar && (
        <Button variant="secondary" onClick={() => setAbierto("editar")}>
          <Pencil strokeWidth={1.75} /> Editar datos
        </Button>
      )}
      {puedeEliminar && activo && (
        <Button variant="secondary" className="text-danger" onClick={() => setAbierto("baja")}>
          <UserX strokeWidth={1.75} /> Desactivar
        </Button>
      )}
      {puedeEditar && !activo && (
        <Button variant="secondary" onClick={() => void reactivar()}>
          <UserCheck strokeWidth={1.75} /> Reactivar
        </Button>
      )}

      <Sheet
        open={abierto === "editar"}
        onOpenChange={(o) => !o && setAbierto(null)}
        title="Editar cliente"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" form="form-cliente-detalle" loading={enviando}>
              Guardar
            </Button>
          </>
        }
      >
        {abierto === "editar" && (
          <ClienteForm
            formId="form-cliente-detalle"
            cliente={cliente}
            onEnviando={setEnviando}
            onListo={() => {
              setAbierto(null);
              router.refresh();
            }}
          />
        )}
      </Sheet>

      <ConfirmDialog
        open={abierto === "baja"}
        onOpenChange={(o) => !o && setAbierto(null)}
        title={`¿Desactivar a ${cliente.nombre}?`}
        description="Deja de aparecer en los buscadores de ventas y devoluciones. No se borra: sus compras y devoluciones se conservan y lo podés reactivar cuando quieras."
        confirmLabel="Desactivar"
        danger
        onConfirm={desactivar}
      />
    </div>
  );
}
