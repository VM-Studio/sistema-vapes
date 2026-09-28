"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  actualizarClienteSchema,
  buscarClientesSchema,
  crearClienteSchema,
  telefonoConsultaSchema,
} from "@/lib/validations/cliente";
import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxAlguno } from "@/server/auth/permissions";
import {
  actualizarCliente,
  buscarClientes,
  clientePorTelefono,
  crearCliente,
  desactivarCliente,
  reactivarCliente,
} from "@/server/services/cliente.service";

/** Desde dónde se elige un cliente (SelectorCliente). */
const MODULOS_SELECTOR = [Modulo.CLIENTES, Modulo.VENTAS, Modulo.DEVOLUCIONES, Modulo.COTIZADOR];

/** CLIENTES (en el panel actual): crear → alta · editar → datos · eliminar → desactivar. */

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

export const desactivarClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.CLIENTES, "eliminar");
  const { id: clienteId } = z.object({ id }).parse(input);
  await desactivarCliente(ctx, clienteId);
  revalidatePath("/p/[slug]/clientes", "layout");
});

export const reactivarClienteAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.CLIENTES, "editar");
  const { id: clienteId } = z.object({ id }).parse(input);
  await reactivarCliente(ctx, clienteId);
  revalidatePath("/p/[slug]/clientes", "layout");
});

/** Buscador del SelectorCliente (nombre o teléfono, máx. 20, con última compra). */
export const buscarClientesAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno(MODULOS_SELECTOR, "ver");
  const { q } = buscarClientesSchema.parse(input);
  return buscarClientes(ctx, q);
});

/** Validación en vivo del teléfono de un cliente nuevo: ¿ya es de alguien? */
export const clientePorTelefonoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxAlguno(MODULOS_SELECTOR, "ver");
  const { telefono } = telefonoConsultaSchema.parse(input);
  return clientePorTelefono(ctx, telefono);
});
