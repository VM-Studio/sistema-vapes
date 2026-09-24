"use server";

import { revalidatePath } from "next/cache";

import {
  actualizarPermisosSchema,
  actualizarUsuarioSchema,
  crearUsuarioSchema,
  usuarioIdSchema,
} from "@/lib/validations/usuario";
import { actionHandler } from "@/server/action-handler";
import { requireOwner } from "@/server/auth/permissions";
import { getRequestMeta } from "@/server/auth/request-meta";
import {
  actualizarPermisos,
  actualizarUsuario,
  crearUsuario,
  darDeBajaUsuario,
  resetearPassword,
  type Actor,
} from "@/server/services/usuario.service";

/**
 * Módulo Usuarios: solo OWNER. Cada acción autoriza PRIMERO (antes de mirar
 * el input) y después valida con el mismo schema Zod que usa el formulario.
 */
async function actorOwner(): Promise<Actor> {
  const owner = await requireOwner();
  return { id: owner.id, meta: await getRequestMeta() };
}

export const crearUsuarioAction = actionHandler(async (input: unknown) => {
  const actor = await actorOwner();
  const usuario = await crearUsuario(actor, crearUsuarioSchema.parse(input));
  revalidatePath("/usuarios");
  return { id: usuario.id };
});

export const actualizarUsuarioAction = actionHandler(async (input: unknown) => {
  const actor = await actorOwner();
  const usuario = await actualizarUsuario(actor, actualizarUsuarioSchema.parse(input));
  revalidatePath("/usuarios");
  return { id: usuario.id };
});

/** Devuelve la contraseña temporal: se muestra UNA vez y no se puede recuperar. */
export const resetearPasswordAction = actionHandler(async (input: unknown) => {
  const actor = await actorOwner();
  const { id } = usuarioIdSchema.parse(input);
  const resultado = await resetearPassword(actor, id);
  revalidatePath("/usuarios");
  return resultado;
});

export const darDeBajaUsuarioAction = actionHandler(async (input: unknown) => {
  const actor = await actorOwner();
  const { id } = usuarioIdSchema.parse(input);
  await darDeBajaUsuario(actor, id);
  revalidatePath("/usuarios");
  return null;
});

export const actualizarPermisosAction = actionHandler(async (input: unknown) => {
  const actor = await actorOwner();
  const datos = actualizarPermisosSchema.parse(input);
  const permisos = await actualizarPermisos(actor, datos);
  revalidatePath(`/usuarios/${datos.usuarioId}/permisos`);
  return permisos;
});
