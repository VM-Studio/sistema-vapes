"use client";

import { Pencil, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClienteForm, type ClienteEditable } from "@/components/clientes/cliente-form";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

import { darDeBajaClienteAction } from "../actions";

export function AccionesCliente({
  cliente,
  puedeEditar,
  puedeEliminar,
}: {
  cliente: ClienteEditable;
  puedeEditar: boolean;
  puedeEliminar: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const ruta = useRutaPanel();
  const [abierto, setAbierto] = useState<"editar" | "baja" | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function darDeBaja() {
    const r = await darDeBajaClienteAction({ id: cliente.id });
    setAbierto(null);
    if (!r.ok) return toast.error("No se pudo dar de baja", r.error.message);
    toast.success(`${cliente.nombre} dado de baja`);
    router.push(ruta("/clientes"));
  }

  if (!puedeEditar && !puedeEliminar) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {puedeEditar && (
        <Button variant="secondary" onClick={() => setAbierto("editar")}>
          <Pencil strokeWidth={1.75} /> Editar datos
        </Button>
      )}
      {puedeEliminar && (
        <Button variant="secondary" className="text-danger" onClick={() => setAbierto("baja")}>
          <UserX strokeWidth={1.75} /> Dar de baja
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
        title={`¿Dar de baja a ${cliente.nombre}?`}
        description="Deja de aparecer en el listado y en el punto de venta. Sus compras se conservan y su teléfono queda libre para otro cliente."
        confirmLabel="Dar de baja"
        danger
        onConfirm={darDeBaja}
      />
    </div>
  );
}
