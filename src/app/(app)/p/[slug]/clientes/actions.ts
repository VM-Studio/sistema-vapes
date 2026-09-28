"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actualizarClienteSchema, crearClienteSchema } from "@/lib/validations/cliente";
import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import {
  actualizarCliente,
  crearCliente,
  darDeBajaCliente,
} from "@/server/services/cliente.service";

/** CLIENTES (en el panel actual): crear → alta · editar → datos · eliminar → baja. */

export const crearClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.CLIENTES, "crear");
  const r = await crearCliente(ctx, crearClienteSchema.parse(input));
  revalidatePath("/p/[slug]/clientes", "page");
  return r;
});

export const actualizarClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.CLIENTES, "editar");
  const r = await actualizarCliente(ctx, actualizarClienteSchema.parse(input));
  revalidatePath("/p/[slug]/clientes", "layout");
  return r;
});

export const darDeBajaClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.CLIENTES, "eliminar");
  const { id: clienteId } = z.object({ id }).parse(input);
  await darDeBajaCliente(ctx, clienteId);
  revalidatePath("/p/[slug]/clientes", "layout");
});
