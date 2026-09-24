"use server";

import { cambiarPasswordSchema } from "@/lib/validations/usuario";
import { actionHandler } from "@/server/action-handler";
import { requireUsuario } from "@/server/auth/permissions";
import { getRequestMeta } from "@/server/auth/request-meta";
import { cambiarPasswordPropia } from "@/server/services/auth.service";

/** Cualquier usuario cambia SU contraseña (incluso con el cambio pendiente). */
export const cambiarPasswordAction = actionHandler(async (input: unknown) => {
  const usuario = await requireUsuario({ permitirCambioPendiente: true });
  const datos = cambiarPasswordSchema.parse(input);
  await cambiarPasswordPropia(usuario.id, datos, await getRequestMeta());
  // Si era el cambio obligatorio, recién ahora puede entrar al resto del sistema.
  return { habilitado: usuario.debeCambiarPassword };
});
