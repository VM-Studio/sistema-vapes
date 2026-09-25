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

import { actualizarClienteAction, crearClienteAction } from "@/app/(app)/clientes/actions";

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
  limiteCredito: string | null;
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
    limiteCredito: c?.limiteCredito ? String(Number(c.limiteCredito)) : "",
  };
}

/** Alta/edición de cliente. El límite de crédito (fiado) solo lo ve y edita el dueño. */
export function ClienteForm({
  formId,
  cliente,
  puedeDefinirLimite,
  onListo,
  onEnviando,
}: {
  formId: string;
  cliente: ClienteEditable | null;
  puedeDefinirLimite: boolean;
  onListo: (c: { id: string }) => void;
  onEnviando?: (e: boolean) => void;
}) {
  const toast = useToast();
  const form = useZodForm(crearClienteSchema, { defaultValues: valoresIniciales(cliente) });
  const enviando = form.formState.isSubmitting;
  useEffect(() => onEnviando?.(enviando), [enviando, onEnviando]);

  async function onSubmit(datos: CrearCliente) {
    // Sin permiso para el límite: se manda el que ya tenía (el servidor rechaza cambios).
    const limite = puedeDefinirLimite
      ? datos.limiteCredito
      : cliente?.limiteCredito
        ? Number(cliente.limiteCredito)
        : undefined;
    if (cliente) {
      const r = await actualizarClienteAction({ ...datos, limiteCredito: limite, id: cliente.id });
      if (!r.ok) return aplicarErroresServidor(form, r.error);
      toast.success("Cliente actualizado");
      onListo({ id: cliente.id });
    } else {
      const r = await crearClienteAction({ ...datos, limiteCredito: limite });
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
        <FormInput name="telefono" label="Teléfono (WhatsApp)" inputMode="tel" autoComplete="off" />
      </div>
      <FormInput name="email" label="Email" type="email" autoComplete="off" />
      <FormInput name="direccion" label="Dirección" autoComplete="off" />
      {puedeDefinirLimite && (
        <FormInput
          name="limiteCredito"
          label="Límite de crédito (fiado)"
          inputMode="decimal"
          hint="Vacío = no se le vende fiado. Solo lo define el dueño."
        />
      )}
      <FormTextarea name="notas" label="Notas" rows={2} />
    </Form>
  );
}
