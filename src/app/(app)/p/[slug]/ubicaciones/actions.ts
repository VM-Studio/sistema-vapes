"use server";

import { revalidatePath } from "next/cache";

import {
  actualizarUbicacionSchema,
  asignarUbicacionSchema,
  crearUbicacionSchema,
  moverUbicacionSchema,
  ubicacionIdSchema,
} from "@/lib/validations/ubicacion";
import { actionHandler } from "@/server/action-handler";
import { requireCtxOwner } from "@/server/auth/permissions";
import {
  actualizarUbicacion,
  asignarUbicacion,
  crearUbicacion,
  eliminarUbicacion,
  moverUbicacion,
} from "@/server/services/ubicacion.service";

/** UBICACIONES DE PRODUCTOS: solo los dueños las arman (Charly las ve). */

function revalidar() {
  revalidatePath("/p/[slug]/ubicaciones", "page");
  revalidatePath("/p/[slug]/escaneo", "page");
}

export const crearUbicacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await crearUbicacion(ctx, crearUbicacionSchema.parse(input));
  revalidar();
  return r;
});

export const actualizarUbicacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id, ...datos } = actualizarUbicacionSchema.parse(input);
  const r = await actualizarUbicacion(ctx, id, datos);
  revalidar();
  return r;
});

export const eliminarUbicacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const r = await eliminarUbicacion(ctx, ubicacionIdSchema.parse(input).id);
  revalidar();
  return r;
});

export const moverUbicacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { id, direccion } = moverUbicacionSchema.parse(input);
  await moverUbicacion(ctx, id, direccion);
  revalidar();
  return { ok: true };
});

export const asignarUbicacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { productoIds, ubicacionId } = asignarUbicacionSchema.parse(input);
  const r = await asignarUbicacion(ctx, productoIds, ubicacionId);
  revalidar();
  return r;
});
