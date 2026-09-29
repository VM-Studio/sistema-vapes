"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProveedorForm, type ProveedorEditable } from "@/components/compras/proveedor-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

import { desactivarProveedorAction } from "../actions";

export function AccionesProveedor({
  proveedor,
  verPrecios,
  puedeEditar,
  puedeEliminar,
}: {
  proveedor: ProveedorEditable;
  verPrecios: boolean;
  puedeEditar: boolean;
  puedeEliminar: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [baja, setBaja] = useState(false);

  if (!puedeEditar && !puedeEliminar) return null;

  async function desactivar() {
    const r = await desactivarProveedorAction({ id: proveedor.id });
    setBaja(false);
    if (!r.ok) return toast.error("No se pudo desactivar", r.error.message);
    toast.success(`${proveedor.nombre} desactivado`, "Sus compras y precios se conservan.");
    router.refresh();
  }

  return (
    <div className="flex gap-2 max-md:[&>button]:flex-1">
      {puedeEliminar && proveedor.activo && (
        <Button variant="ghost" className="text-danger" onClick={() => setBaja(true)}>
          Desactivar
        </Button>
      )}
      {puedeEditar && (
        <Button variant="secondary" onClick={() => setEditando(true)}>
          Editar datos
        </Button>
      )}
      <ConfirmDialog
        open={baja}
        onOpenChange={setBaja}
        title={`¿Desactivar a ${proveedor.nombre}?`}
        description="Deja de aparecer para nuevas compras. Sus compras y precios se conservan y lo podés reactivar desde «Editar datos»."
        confirmLabel="Desactivar"
        danger
        onConfirm={desactivar}
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
            verPrecios={verPrecios}
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
