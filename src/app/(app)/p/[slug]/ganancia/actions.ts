"use server";

import { revalidatePath } from "next/cache";

import { firmarRemitoSchema } from "@/lib/validations/ganancia-vendedor";
import { actionHandler } from "@/server/action-handler";
import { requireCtxPanelUsuario } from "@/server/auth/permissions";
import { firmarDesdeSesion } from "@/server/services/remito-liquidacion.service";

/** El vendedor firma su remito logueado (el servicio exige que sea suyo). */
export const firmarRemitoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxPanelUsuario();
  const { id, firma } = firmarRemitoSchema.parse(input);
  const r = await firmarDesdeSesion(ctx, id, firma);
  revalidatePath("/p/[slug]", "layout");
  return r;
});
