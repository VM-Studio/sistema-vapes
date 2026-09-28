"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProveedorForm, type ProveedorEditable } from "@/components/compras/proveedor-form";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

import { darDeBajaProveedorAction } from "../actions";

export function AccionesProveedor({
  proveedor,
  puedeEditar,
  puedeEliminar,
}: {
  proveedor: ProveedorEditable;
  puedeEditar: boolean;
  puedeEliminar: boolean;
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [baja, setBaja] = useState(false);

  if (!puedeEditar && !puedeEliminar) return null;

  async function darDeBaja() {
    const r = await darDeBajaProveedorAction({ id: proveedor.id });
    setBaja(false);
    if (!r.ok) return toast.error("No se pudo dar de baja", r.error.message);
    toast.success(`${proveedor.nombre} dado de baja`, "Sus compras quedan en el historial.");
    router.push(ruta("/proveedores"));
  }

  return (
    <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
      {puedeEliminar && (
        <Button variant="secondary" className="text-danger" onClick={() => setBaja(true)}>
          Dar de baja
        </Button>
      )}
      {puedeEditar && <Button onClick={() => setEditando(true)}>Editar datos</Button>}
      <ConfirmDialog
        open={baja}
        onOpenChange={setBaja}
        title={`¿Dar de baja a ${proveedor.nombre}?`}
        description="Deja de aparecer en las listas. Sus compras se conservan."
        confirmLabel="Dar de baja"
        danger
        onConfirm={darDeBaja}
      />
      <Sheet
        open={editando}
        onOpenChange={setEditando}
        title="Editar proveedor"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditando(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" form="form-proveedor-detalle" loading={enviando}>
              Guardar
            </Button>
          </>
        }
      >
        {editando && (
          <ProveedorForm
            formId="form-proveedor-detalle"
            proveedor={proveedor}
            onEnviando={setEnviando}
            onListo={() => {
              setEditando(false);
              router.refresh();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
