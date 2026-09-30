"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { ajusteSchema } from "@/lib/validations/movimiento";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import { registrarAjuste } from "@/server/services/movimiento.service";

/**
 * Permisos del módulo STOCK (en el panel actual):
 *   ver    → stock por galpón / global y movimientos
 *   editar → ajustar (conteo real)
 * Las transferencias tienen sus acciones en /stock/transferencias/actions.ts.
 */

function revalidarStock() {
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
}

export const ajusteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.STOCK, "editar");
  const r = await registrarAjuste(ctx, ajusteSchema.parse(input));
  revalidarStock();
  return r;
});
