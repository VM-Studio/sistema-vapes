"use server";

import { revalidatePath } from "next/cache";

import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requireOwner } from "@/server/auth/permissions";
import { ValidationError } from "@/server/errors";
import { MAX_IMAGEN_BYTES } from "@/server/seguridad/archivos";
import { texto } from "@/lib/validations/common";
import {
  guardarIconoPropio,
  guardarNombreNegocio,
  quitarIconoPropio,
} from "@/server/services/identidad.service";

/** Ícono de la app instalada (solo dueños). Se valida por magic bytes y se re-codifica. */
export const subirIconoAction = actionHandler(async (form: FormData) => {
  const usuario = await requireOwner();
  const archivo = form.get("icono");
  if (!(archivo instanceof File) || archivo.size === 0)
    throw new ValidationError("Elegí una imagen", { icono: ["Elegí una imagen"] });
  if (archivo.size > MAX_IMAGEN_BYTES)
    throw new ValidationError("La imagen supera los 5 MB", { icono: ["Máximo 5 MB"] });
  await guardarIconoPropio(new Uint8Array(await archivo.arrayBuffer()), await actorDe(usuario));
  revalidatePath("/configuracion/negocio");
});

export const quitarIconoAction = actionHandler(async () => {
  const usuario = await requireOwner();
  await quitarIconoPropio(await actorDe(usuario));
  revalidatePath("/configuracion/negocio");
});

/** Nombre del negocio (global: lo usan la app instalada, el login y las exportaciones). */
export const guardarNombreNegocioAction = actionHandler(async (input: unknown) => {
  const usuario = await requireOwner();
  const nombre = texto(60).parse(input);
  await guardarNombreNegocio(nombre, await actorDe(usuario));
  revalidatePath("/configuracion/negocio");
});
