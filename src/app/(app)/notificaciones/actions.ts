"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { requireUsuario } from "@/server/auth/permissions";
import { marcarLeida, marcarTodasLeidas } from "@/server/services/notificacion.service";

/** Cada usuario solo toca sus propias notificaciones (el servicio filtra por usuarioId). */
export const marcarLeidaAction = actionHandler(async (input: unknown) => {
  const usuario = await requireUsuario();
  await marcarLeida(z.object({ id }).parse(input).id, usuario.id);
  revalidatePath("/", "layout");
});

export const marcarTodasLeidasAction = actionHandler(async () => {
  const usuario = await requireUsuario();
  const n = await marcarTodasLeidas(usuario.id);
  revalidatePath("/", "layout");
  return n;
});
