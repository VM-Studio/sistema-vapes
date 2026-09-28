"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import { actualizarProveedorSchema, crearProveedorSchema } from "@/lib/validations/proveedor";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import {
  actualizarProveedor,
  crearProveedor,
  darDeBajaProveedor,
} from "@/server/services/proveedor.service";

/** PROVEEDORES del panel: crear · editar (incluye activo) · eliminar (dar de baja). */

export const crearProveedorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "crear");
  const r = await crearProveedor(ctx, crearProveedorSchema.parse(input));
  revalidatePath("/p/[slug]/proveedores", "layout");
  return r;
});

export const actualizarProveedorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "editar");
  const r = await actualizarProveedor(ctx, actualizarProveedorSchema.parse(input));
  revalidatePath("/p/[slug]/proveedores", "layout");
  return r;
});

export const darDeBajaProveedorAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PROVEEDORES, "eliminar");
  const { id: proveedorId } = z.object({ id }).parse(input);
  await darDeBajaProveedor(ctx, proveedorId);
  revalidatePath("/p/[slug]/proveedores", "layout");
  return null;
});
