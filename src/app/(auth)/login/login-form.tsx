"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { aplicarErroresServidor, Form, FormInput, useZodForm } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import { registrarLogin } from "@/components/pwa/banner-instalar";
import { loginSchema } from "@/lib/validations/usuario";

export function LoginForm({ next }: { next?: string }) {
  const form = useZodForm(loginSchema, { defaultValues: { email: "", password: "" } });
  const [verPassword, setVerPassword] = useState(false);

  async function onSubmit(data: { email: string; password: string }) {
    let resultado: ActionResult<{ redirectTo: string }>;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...data, next }),
      });
      resultado = (await res.json()) as ActionResult<{ redirectTo: string }>;
    } catch {
      form.setError("root", {
        message: "No se pudo conectar. Revisá tu conexión e intentá de nuevo.",
      });
      return;
    }

    if (resultado.ok) {
      // Navegación completa: el layout protegido se carga con la sesión nueva.
      registrarLogin(); // el banner de "Instalá la app" aparece desde el segundo ingreso
      window.location.assign(resultado.data.redirectTo);
      return;
    }
    form.setValue("password", "");
    aplicarErroresServidor(form, resultado.error);
  }

  return (
    <Form form={form} onSubmit={onSubmit}>
      <FormInput
        name="email"
        label="Email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
      />
      <div className="relative">
        <FormInput
          name="password"
          label="Contraseña"
          type={verPassword ? "text" : "password"}
          autoComplete="current-password"
          className="pr-12"
        />
        <button
          type="button"
          onClick={() => setVerPassword((v) => !v)}
          className="text-muted absolute top-[1.625rem] right-0 flex size-11 items-center justify-center"
          aria-label={verPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {verPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>
      <Button type="submit" size="lg" fullWidth loading={form.formState.isSubmitting}>
        Ingresar
      </Button>
    </Form>
  );
}
