"use server";

import { revalidatePath } from "next/cache";

import { crearPanelSchema } from "@/lib/validations/panel";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requireOwner } from "@/server/auth/permissions";
import { ValidationError } from "@/server/errors";
import { MAX_IMAGEN_BYTES } from "@/server/seguridad/archivos";
import { crearPanel, desactivarPanel } from "@/server/services/panel.service";

/** Alta de un panel (solo dueños): datos + logo opcional (se valida por magic bytes y se re-codifica). */
export const crearPanelAction = actionHandler(async (form: FormData) => {
  const usuario = await requireOwner();
  const datos = crearPanelSchema.parse({
    nombre: form.get("nombre"),
    slug: form.get("slug"),
    colorAcento: form.get("colorAcento") ?? undefined,
    etiquetaEspecificacion: form.get("etiquetaEspecificacion"),
  });
  const logo = form.get("logo");
  let bytes: Uint8Array | null = null;
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > MAX_IMAGEN_BYTES)
      throw new ValidationError("El logo supera los 5 MB", { logo: ["Máximo 5 MB"] });
    bytes = new Uint8Array(await logo.arrayBuffer());
  }
  const panel = await crearPanel(datos, bytes, await actorDe(usuario));
  revalidatePath("/paneles");
  return { slug: panel.slug };
});

/** Baja lógica de un panel (solo dueños): deja de aparecer; sus datos quedan. */
export const desactivarPanelAction = actionHandler(async (panelId: unknown) => {
  const usuario = await requireOwner();
  if (typeof panelId !== "string") throw new ValidationError("Panel inválido");
  await desactivarPanel(panelId, await actorDe(usuario));
  revalidatePath("/paneles");
  revalidatePath("/configuracion/sistemas");
});
