"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";

import { useRutaPanel } from "@/components/layout/panel-context";
import {
  AYUDA_ORIGEN,
  ETIQUETA_ORIGEN,
  opcionesOrigen,
  useOrigenesCliente,
} from "@/components/clientes/origen-cliente";
import {
  aplicarErroresServidor,
  Form,
  FormInput,
  FormSelect,
  FormTextarea,
  useZodForm,
} from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { crearClienteSchema, telefonoValido } from "@/lib/validations/cliente";

import {
  actualizarClienteAction,
  clientePorTelefonoAction,
  crearClienteAction,
} from "@/app/(app)/p/[slug]/clientes/actions";

/** «De quién viene» se exige en onSubmit solo si se pide (alta, o un dueño editando). */
const schemaForm = crearClienteSchema.extend({ origenId: z.string().trim().optional() });

export interface ClienteEditable {
  id: string;
  nombre: string;
  telefono: string;
  notas: string | null;
  /** «De quién viene» (null = cargado antes y todavía sin responder). */
  origenId: string | null;
}

/**
 * Alta/edición de cliente del panel actual. El teléfono se guarda normalizado
 * (+54…) y no se repite: mientras se escribe se avisa si ya es de otro cliente.
 * «¿De quién viene?» es obligatorio al dar de alta; al editar solo lo ve y lo
 * cambia un dueño (`puedeCambiarOrigen`).
 */
export function ClienteForm({
  formId,
  cliente,
  onListo,
  onEnviando,
  puedeCambiarOrigen = false,
}: {
  formId: string;
  cliente: ClienteEditable | null;
  onListo: (c: { id: string }) => void;
  onEnviando?: (e: boolean) => void;
  puedeCambiarOrigen?: boolean;
}) {
  const origenes = useOrigenesCliente();
  const pideOrigen = !cliente || puedeCambiarOrigen;
  const toast = useToast();
  const ruta = useRutaPanel();
  const [existente, setExistente] = useState<{ id: string; nombre: string } | null>(null);
  const form = useZodForm(schemaForm, {
    defaultValues: {
      nombre: cliente?.nombre ?? "",
      telefono: cliente?.telefono ?? "",
      notas: cliente?.notas ?? "",
      origenId: cliente?.origenId ?? "",
    },
  });
  const enviando = form.formState.isSubmitting;
  useEffect(() => onEnviando?.(enviando), [enviando, onEnviando]);

  const telefono = telefonoValido(form.watch("telefono"));
  useEffect(() => {
    setExistente(null);
    if (!telefono || telefono === cliente?.telefono) return;
    let vigente = true;
    const t = setTimeout(async () => {
      const r = await clientePorTelefonoAction({ telefono });
      if (vigente && r.ok && r.data && r.data.id !== cliente?.id) setExistente(r.data);
    }, 350);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [telefono, cliente?.id, cliente?.telefono]);

  async function onSubmit(datos: z.output<typeof schemaForm>) {
    if (pideOrigen && !datos.origenId) {
      form.setError("origenId", { message: "Elegí de quién viene el cliente" });
      return;
    }
    if (cliente) {
      const r = await actualizarClienteAction({
        ...datos,
        id: cliente.id,
        origenId: pideOrigen ? datos.origenId : undefined,
      });
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
      <FormInput name="nombre" label="Nombre" required autoComplete="off" />
      <FormInput
        name="telefono"
        label="Teléfono"
        required
        type="tel"
        inputMode="tel"
        autoComplete="off"
        hint={telefono ? `Se guarda como ${telefono}` : "Con código de área. Ej: 11 5555 1234"}
      />
      {existente && (
        <p
          role="status"
          className="bg-warning-soft text-warning-soft-foreground rounded-control px-4 py-3 text-sm"
        >
          Ese teléfono es de{" "}
          <Link href={ruta(`/clientes/${existente.id}`)} className="font-semibold underline">
            {existente.nombre}
          </Link>
          .
        </p>
      )}
      {pideOrigen && (
        <FormSelect
          name="origenId"
          label={ETIQUETA_ORIGEN}
          hint={AYUDA_ORIGEN}
          required
          placeholder={origenes ? "Elegí una opción" : "Cargando…"}
          options={opcionesOrigen(origenes)}
        />
      )}
      <FormTextarea name="notas" label="Notas" rows={2} />
    </Form>
  );
}
