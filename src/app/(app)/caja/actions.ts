"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import {
  abrirCajaSchema,
  cerrarCajaSchema,
  movimientoManualCajaSchema,
} from "@/lib/validations/finanzas";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requireAccesoCaja } from "@/server/auth/caja-acceso";
import { requireOwner, requirePermiso } from "@/server/auth/permissions";
import { pdfCierreCaja } from "@/server/reportes/cierre-caja";
import {
  abrirCaja,
  cerrarCaja,
  registrarIngresoExtra,
  registrarRetiro,
} from "@/server/services/caja.service";
import { avisarCajaConDiferencia } from "@/server/services/notificacion.service";
import { claveAleatoria, storage, urlCompartible } from "@/server/storage";
import { log } from "@/server/log";

/** CAJA: crear → abrir, cerrar, ingreso extra. Retiros: solo dueños. */

function revalidar() {
  revalidatePath("/caja", "layout");
  revalidatePath("/");
}

export const abrirCajaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CAJA, "crear");
  const r = await abrirCaja(abrirCajaSchema.parse(input), await actorDe(usuario));
  revalidar();
  return r;
});

export const ingresoExtraAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CAJA, "crear");
  const r = await registrarIngresoExtra(
    movimientoManualCajaSchema.parse(input),
    await actorDe(usuario),
  );
  revalidar();
  return r;
});

export const retiroAction = actionHandler(async (input: unknown) => {
  const usuario = await requireOwner();
  const r = await registrarRetiro(movimientoManualCajaSchema.parse(input), await actorDe(usuario));
  revalidar();
  return r;
});

export const cerrarCajaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.CAJA, "crear");
  const datos = cerrarCajaSchema.parse(input);
  const r = await cerrarCaja(datos.cajaId, datos, await actorDe(usuario));
  // Después del COMMIT: si el aviso falla, la caja igual quedó cerrada.
  if (r.requiereRevision)
    await avisarCajaConDiferencia(r.id).catch((e: unknown) =>
      log.error({ err: e }, "no se pudo avisar la diferencia de caja"),
    );
  revalidar();
  return r;
});

/** PDF del cierre con link público inadivinable, para mandarlo por WhatsApp. */
export const compartirCierreAction = actionHandler(async (input: unknown) => {
  const { cajaId } = z.object({ cajaId: id }).parse(input);
  const usuario = await requireAccesoCaja(cajaId);
  const pdf = await pdfCierreCaja(cajaId, usuario.nombre);
  const ref = await storage.guardar(
    claveAleatoria("cajas", "cierre", "pdf"),
    pdf,
    "application/pdf",
  );
  return { url: await urlCompartible(ref) };
});
