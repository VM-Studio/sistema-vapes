"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import { actualizarProveedorSchema, crearProveedorSchema } from "@/lib/validations/proveedor";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requirePermiso } from "@/server/auth/permissions";
import {
  actualizarProveedor,
  crearProveedor,
  darDeBajaProveedor,
} from "@/server/services/proveedor.service";

/** PROVEEDORES: crear · editar (incluye activo) · eliminar (dar de baja). */

export const crearProveedorAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PROVEEDORES, "crear");
  const r = await crearProveedor(crearProveedorSchema.parse(input), await actorDe(usuario));
  revalidatePath("/proveedores");
  return r;
});

export const actualizarProveedorAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PROVEEDORES, "editar");
  const datos = actualizarProveedorSchema.parse(input);
  const r = await actualizarProveedor(datos, await actorDe(usuario));
  revalidatePath("/proveedores", "layout");
  return r;
});

export const darDeBajaProveedorAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.PROVEEDORES, "eliminar");
  const { id: proveedorId } = z.object({ id }).parse(input);
  await darDeBajaProveedor(proveedorId, await actorDe(usuario));
  revalidatePath("/proveedores", "layout");
  return null;
});
