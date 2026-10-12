"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { deshacerPagoPasistaSchema, marcarPagadasSchema } from "@/lib/validations/pasista";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import { deshacerPago, marcarPagadas } from "@/server/services/pasista.service";

/** PASISTA: ver = acumulado y detalle · marcar pagadas y deshacer pagos: solo dueños (lo exige el servicio). */

function revalidar() {
  revalidatePath("/p/[slug]/pasista", "layout");
}

export const marcarPagadasPasistaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PASISTA, "ver");
  const datos = marcarPagadasSchema.parse(input);
  const pago = { medioPago: datos.medioPago, referencia: datos.referencia, fecha: datos.fecha };
  const r = await marcarPagadas(
    ctx,
    "ids" in datos ? { ids: datos.ids } : { mes: datos.mes },
    pago,
  );
  revalidar();
  return r;
});

export const deshacerPagoPasistaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PASISTA, "ver");
  const { id, motivo } = deshacerPagoPasistaSchema.parse(input);
  await deshacerPago(ctx, id, motivo);
  revalidar();
  return { ok: true };
});
