"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { puede } from "@/lib/permisos";
import { ventaIdSchema } from "@/lib/validations/venta";
import { actionHandler } from "@/server/action-handler";
import { requireCtxPanelUsuario } from "@/server/auth/permissions";
import { marcarRetirada } from "@/server/services/retiro.service";

/**
 * «Retirado»: el cliente se llevó la mercadería. Con VENTAS «crear», o el
 * usuario de escaneo (ESCANEO «ver») para las ventas que ya escaneó. Lo valida
 * el servicio. No mueve stock, pero cambia las tarjetas de Stock (escaneado →
 * retirado) y el listado de ventas.
 */
export const marcarRetiradaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxPanelUsuario();
  const { ventaId } = ventaIdSchema.parse(input);
  const r = await marcarRetirada(ctx, ventaId, {
    porVentas: puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "crear"),
    porEscaneo: puede(ctx.usuario, ctx.panelId, Modulo.ESCANEO, "ver"),
  });
  revalidatePath("/p/[slug]/ventas", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
  revalidatePath("/p/[slug]/escaneo", "page");
  revalidatePath("/p/[slug]", "page");
  return r;
});
