"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  anularFacturaSchema,
  facturarVentaSchema,
  facturaSueltaSchema,
  numeroExternoSchema,
} from "@/lib/validations/factura";
import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxOwner } from "@/server/auth/permissions";
import { DomainError } from "@/server/errors";
import {
  anular,
  crearDesdeVenta,
  crearSuelta,
  registrarNumeroExterno,
  subirArchivo,
  ventaParaFacturar,
} from "@/server/services/factura.service";

/**
 * Permisos de FACTURAS (en el panel actual):
 *   ver → listado, detalle y PDF · crear → facturar una venta o una suelta
 *   editar → subir el PDF real y cargar el número fiscal · anular → solo dueños
 * Importes, numeración y validaciones fiscales: el servicio.
 */

function revalidar() {
  revalidatePath("/p/[slug]/facturas", "layout");
  revalidatePath("/p/[slug]/ventas", "layout");
}

export const facturarVentaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.FACTURAS, "crear");
  const r = await crearDesdeVenta(ctx, facturarVentaSchema.parse(input));
  revalidar();
  return r;
});

export const facturaSueltaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.FACTURAS, "crear");
  const r = await crearSuelta(ctx, facturaSueltaSchema.parse(input));
  revalidar();
  return r;
});

export const anularFacturaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id: facturaId, motivo } = anularFacturaSchema.parse(input);
  const r = await anular(ctx, facturaId, motivo);
  revalidar();
  return r;
});

export const numeroExternoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.FACTURAS, "editar");
  const { id: facturaId, numeroExterno } = numeroExternoSchema.parse(input);
  const r = await registrarNumeroExterno(ctx, facturaId, numeroExterno);
  revalidar();
  return r;
});

/** FormData: `id` + `archivo` (el PDF de la factura emitida por fuera). */
export const subirPdfFacturaAction = actionHandler(async (form: FormData) => {
  const ctx = await requireCtx(Modulo.FACTURAS, "editar");
  const facturaId = id.parse(form.get("id"));
  const archivo = form.get("archivo");
  if (!(archivo instanceof File)) throw new DomainError("Elegí el PDF de la factura.");
  const r = await subirArchivo(ctx, facturaId, new Uint8Array(await archivo.arrayBuffer()));
  revalidar();
  return r;
});

/** «Nueva factura» → buscar la venta por su ID (COS-000123 o 123). */
export const buscarVentaFacturarAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.FACTURAS, "crear");
  const { texto } = z.object({ texto: z.string().trim().min(1).max(40) }).parse(input);
  return ventaParaFacturar(ctx, texto);
});
