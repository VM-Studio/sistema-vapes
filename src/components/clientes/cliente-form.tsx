"use client";

import { useEffect } from "react";

import {
  aplicarErroresServidor,
  Form,
  FormInput,
  FormTextarea,
  useZodForm,
} from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { crearClienteSchema, type CrearCliente } from "@/lib/validations/cliente";

import { actualizarClienteAction, crearClienteAction } from "@/app/(app)/p/[slug]/clientes/actions";

export interface ClienteEditable {
  id: string;
  nombre: string;
  apellido: string | null;
  documento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
}

function valoresIniciales(c: ClienteEditable | null) {
  return {
    nombre: c?.nombre ?? "",
    apellido: c?.apellido ?? "",
    documento: c?.documento ?? "",
    telefono: c?.telefono ?? "",
    email: c?.email ?? "",
    direccion: c?.direccion ?? "",
    notas: c?.notas ?? "",
    activo: c?.activo ?? true,
  };
}

/** Alta/edición de cliente del panel actual. El teléfono se guarda normalizado (+54…) y no se repite. */
export function ClienteForm({
  formId,
  cliente,
  onListo,
  onEnviando,
}: {
  formId: string;
  cliente: ClienteEditable | null;
  onListo: (c: { id: string }) => void;
  onEnviando?: (e: boolean) => void;
}) {
  const toast = useToast();
  const form = useZodForm(crearClienteSchema, { defaultValues: valoresIniciales(cliente) });
  const enviando = form.formState.isSubmitting;
  useEffect(() => onEnviando?.(enviando), [enviando, onEnviando]);

  async function onSubmit(datos: CrearCliente) {
    if (cliente) {
      const r = await actualizarClienteAction({ ...datos, id: cliente.id });
      if (!r.ok) return aplicarErroresServidor(form, r.error);
      toast.success("Cliente actualizado");
      onListo({ id: cliente.id });
    } else {
      const r = await crearClienteAction(datos);
      if (!r.ok) return aplicarErroresServidor(form, r.error);
      toast.success(`Cliente ${r.data.nombre} creado`);
      onListo({ id: r.data.id });
    }
  }

  return (
    <Form form={form} onSubmit={onSubmit} id={formId} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <FormInput name="nombre" label="Nombre" required autoComplete="off" />
        <FormInput name="apellido" label="Apellido" autoComplete="off" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormInput name="documento" label="DNI / CUIT" autoComplete="off" />
        <FormInput
          name="telefono"
          label="Teléfono"
          inputMode="tel"
          autoComplete="off"
          hint="Con código de área. Se guarda como +54…"
        />
      </div>
      <FormInput name="email" label="Email" type="email" autoComplete="off" />
      <FormInput name="direccion" label="Dirección" autoComplete="off" />
      <FormTextarea name="notas" label="Notas" rows={2} />
    </Form>
  );
}
