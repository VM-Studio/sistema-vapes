"use client";

import { useRouter } from "next/navigation";

import { RolUsuario } from "@prisma/client";
import { Shuffle } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  aplicarErroresServidor,
  Form,
  FormInput,
  FormSelect,
  FormSwitch,
  useZodForm,
} from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import {
  actualizarUsuarioSchema,
  crearUsuarioSchema,
  type ActualizarUsuario,
  type CrearUsuario,
} from "@/lib/validations/usuario";
import type { UsuarioListado } from "@/server/services/usuario.service";

import { actualizarUsuarioAction, crearUsuarioAction } from "./actions";

export const FORM_USUARIO_ID = "form-usuario";

const OPCIONES_ROL = [
  { value: RolUsuario.EMPLEADO, label: "Empleado (sistemas y permisos a elección)" },
  { value: RolUsuario.OWNER, label: "Dueño (acceso total a todos los sistemas)" },
];

/** Contraseña inicial sugerida (el usuario la cambia en su primer ingreso). */
function passwordAleatoria(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digitos = "23456789";
  const todos = letras + digitos;
  const rnd = crypto.getRandomValues(new Uint32Array(12));
  const chars = Array.from(rnd, (n) => todos[n % todos.length]!);
  chars[rnd[0]! % 12] = letras[rnd[1]! % letras.length]!;
  chars[(rnd[0]! + 5) % 12] = digitos[rnd[2]! % digitos.length]!;
  return chars.join("");
}

interface Props {
  onListo: () => void;
  /** El botón de envío está en el footer del Sheet (fuera del form): le avisamos el estado. */
  onEnviando: (enviando: boolean) => void;
}

function useReportarEnvio(enviando: boolean, onEnviando: (e: boolean) => void) {
  useEffect(() => onEnviando(enviando), [enviando, onEnviando]);
}

export function CrearUsuarioForm({ onListo, onEnviando }: Props) {
  const toast = useToast();
  const router = useRouter();
  const form = useZodForm(crearUsuarioSchema, {
    defaultValues: { nombre: "", email: "", rol: RolUsuario.EMPLEADO, password: "" },
  });
  useReportarEnvio(form.formState.isSubmitting, onEnviando);

  async function onSubmit(data: CrearUsuario) {
    const r = await crearUsuarioAction(data);
    if (!r.ok) return aplicarErroresServidor(form, r.error);
    if (data.rol === RolUsuario.EMPLEADO) {
      toast.success("Usuario creado", "Ahora elegí a qué sistemas accede y qué puede hacer.");
      router.push(`/usuarios/${r.data.id}`);
      return;
    }
    toast.success("Usuario creado");
    onListo();
  }

  return (
    <Form form={form} onSubmit={onSubmit} id={FORM_USUARIO_ID}>
      <FormInput name="nombre" label="Nombre" autoComplete="off" required />
      <FormInput
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        required
      />
      <FormSelect name="rol" label="Rol" options={OPCIONES_ROL} required />
      <div className="flex flex-col gap-1">
        <FormInput
          name="password"
          label="Contraseña inicial"
          autoComplete="new-password"
          spellCheck={false}
          hint="Va a tener que cambiarla en su primer ingreso."
          className="font-mono"
          required
        />
        <Button
          variant="ghost"
          size="sm"
          className="text-primary self-start"
          onClick={() => form.setValue("password", passwordAleatoria(), { shouldValidate: true })}
        >
          <Shuffle /> Generar una
        </Button>
      </div>
    </Form>
  );
}

export function EditarUsuarioForm({
  usuario,
  esUnoMismo,
  onListo,
  onEnviando,
}: Props & { usuario: UsuarioListado; esUnoMismo: boolean }) {
  const toast = useToast();
  const form = useZodForm(actualizarUsuarioSchema, {
    defaultValues: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      activo: usuario.activo,
    },
  });
  useReportarEnvio(form.formState.isSubmitting, onEnviando);

  async function onSubmit(data: ActualizarUsuario) {
    const r = await actualizarUsuarioAction(data);
    if (!r.ok) return aplicarErroresServidor(form, r.error);
    toast.success("Cambios guardados");
    onListo();
  }

  return (
    <Form form={form} onSubmit={onSubmit} id={FORM_USUARIO_ID}>
      <FormInput name="nombre" label="Nombre" autoComplete="off" required />
      <FormInput
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        required
      />
      {esUnoMismo ? (
        // Sin inputs deshabilitados: react-hook-form los excluiría del envío.
        // Los valores (OWNER, activo) viajan igual desde defaultValues.
        <p className="bg-surface-2 text-muted rounded-lg px-3 py-2.5 text-sm">
          Sos vos: no podés cambiar tu propio rol ni desactivarte.
        </p>
      ) : (
        <>
          <FormSelect name="rol" label="Rol" options={OPCIONES_ROL} />
          <FormSwitch
            name="activo"
            label="Usuario activo"
            hint="Si lo desactivás, no puede ingresar y su sesión se corta en el próximo request."
          />
        </>
      )}
    </Form>
  );
}
