"use client";

import { useEffect } from "react";

import {
  aplicarErroresServidor,
  Form,
  FormInput,
  FormSwitch,
  FormTextarea,
  useZodForm,
} from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { crearProveedorSchema, type CrearProveedor } from "@/lib/validations/proveedor";

import { actualizarProveedorAction, crearProveedorAction } from "@/app/(app)/proveedores/actions";

export interface ProveedorEditable {
  id: string;
  nombre: string;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion?: string | null;
  notas?: string | null;
  activo: boolean;
}

function valoresIniciales(p: ProveedorEditable | null) {
  return {
    nombre: p?.nombre ?? "",
    cuit: p?.cuit ?? "",
    telefono: p?.telefono ?? "",
    email: p?.email ?? "",
    direccion: p?.direccion ?? "",
    notas: p?.notas ?? "",
    activo: p?.activo ?? true,
  };
}

/** Alta/edición de proveedor. `compacto` = solo lo esencial (crear rápido desde una compra). */
export function ProveedorForm({
  formId,
  proveedor,
  compacto = false,
  onListo,
  onEnviando,
}: {
  formId: string;
  proveedor: ProveedorEditable | null;
  compacto?: boolean;
  onListo: (p: { id: string; nombre: string }) => void;
  onEnviando?: (e: boolean) => void;
}) {
  const toast = useToast();
  const form = useZodForm(crearProveedorSchema, { defaultValues: valoresIniciales(proveedor) });
  const enviando = form.formState.isSubmitting;
  useEffect(() => onEnviando?.(enviando), [enviando, onEnviando]);

  async function onSubmit(datos: CrearProveedor) {
    if (proveedor) {
      const r = await actualizarProveedorAction({ ...datos, id: proveedor.id });
      if (!r.ok) return aplicarErroresServidor(form, r.error);
      toast.success("Proveedor actualizado");
      onListo({ id: proveedor.id, nombre: datos.nombre });
    } else {
      const r = await crearProveedorAction(datos);
      if (!r.ok) return aplicarErroresServidor(form, r.error);
      toast.success("Proveedor creado", r.data.nombre);
      onListo(r.data);
    }
  }

  return (
    <Form form={form} onSubmit={onSubmit} id={formId}>
      <FormInput name="nombre" label="Nombre / razón social" required />
      <FormInput
        name="cuit"
        label="CUIT"
        inputMode="numeric"
        placeholder="20-12345678-6"
        hint="Opcional. Se valida el dígito verificador."
      />
      <FormInput name="telefono" label="Teléfono" type="tel" inputMode="tel" />
      <FormInput name="email" label="Email" type="email" inputMode="email" autoCapitalize="none" />
      {!compacto && (
        <>
          <FormInput name="direccion" label="Dirección" />
          <FormTextarea name="notas" label="Notas" rows={2} />
          <FormSwitch name="activo" label="Activo" />
        </>
      )}
    </Form>
  );
}
