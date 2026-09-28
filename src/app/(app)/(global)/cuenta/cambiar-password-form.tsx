"use client";

import { Button } from "@/components/ui/button";
import { aplicarErroresServidor, Form, FormInput, useZodForm } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cambiarPasswordSchema, type CambiarPassword } from "@/lib/validations/usuario";

import { cambiarPasswordAction } from "./actions";

export function CambiarPasswordForm() {
  const toast = useToast();
  const form = useZodForm(cambiarPasswordSchema, {
    defaultValues: { passwordActual: "", passwordNueva: "", confirmacion: "" },
  });

  async function onSubmit(data: CambiarPassword) {
    const r = await cambiarPasswordAction(data);
    if (!r.ok) return aplicarErroresServidor(form, r.error);
    form.reset();
    toast.success("Contraseña actualizada");
    // Carga completa: el layout deja el modo restringido y muestra la navegación.
    if (r.data.habilitado) window.location.assign("/");
  }

  return (
    <Form form={form} onSubmit={onSubmit}>
      <FormInput
        name="passwordActual"
        label="Contraseña actual"
        type="password"
        autoComplete="current-password"
      />
      <FormInput
        name="passwordNueva"
        label="Contraseña nueva"
        type="password"
        autoComplete="new-password"
        hint="Mínimo 8 caracteres, con al menos una letra y un número."
      />
      <FormInput
        name="confirmacion"
        label="Repetir contraseña nueva"
        type="password"
        autoComplete="new-password"
      />
      <div className="flex md:justify-end">
        <Button type="submit" loading={form.formState.isSubmitting} className="w-full md:w-auto">
          Cambiar contraseña
        </Button>
      </div>
    </Form>
  );
}
