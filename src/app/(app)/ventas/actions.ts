"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { puede } from "@/lib/permisos";
import { crearClienteSchema } from "@/lib/validations/cliente";
import { id } from "@/lib/validations/common";
import {
  anularPagoSchema,
  anularVentaSchema,
  borradorVentaSchema,
  devolucionSchema,
  pagoACuentaSchema,
  registrarPagoSchema,
  venderSchema,
} from "@/lib/validations/venta";
import { actionHandler } from "@/server/action-handler";
import { actorDe } from "@/server/auth/actor";
import { requireOwner, requirePermiso, requirePermisoAlguno } from "@/server/auth/permissions";
import {
  buscarClientesPos,
  crearCliente,
  obtenerClientePos,
} from "@/server/services/cliente.service";
import { buscarVariantes, obtenerVariantesPorId } from "@/server/services/producto.service";
import {
  actualizarBorrador,
  anularPago,
  anularVenta,
  crearBorrador,
  crearDevolucion,
  descartarBorrador,
  pagarACuenta,
  productosRapidos,
  registrarPago,
  vender,
} from "@/server/services/venta.service";

/**
 * Permisos de VENTAS:
 *   ver → listado y detalle · crear → vender (POS) y borradores
 *   editar → precio manual, descuento global, vender fiado, cobrar saldos, devoluciones
 *   eliminar → anular ventas · anular un pago: solo OWNER
 * Los precios, costos y totales los calcula el servicio: acá solo se decide qué puede el usuario.
 */

function revalidar(ventaId?: string, clienteId?: string | null) {
  revalidatePath("/ventas");
  if (ventaId) revalidatePath(`/ventas/${ventaId}`);
  revalidatePath("/inventario");
  revalidatePath("/movimientos");
  revalidatePath("/clientes");
  if (clienteId) revalidatePath(`/clientes/${clienteId}`);
}

/** POS: guarda el borrador (nuevo o retomado) y lo confirma en una sola transacción. */
export const venderAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.VENTAS, "crear");
  const datos = venderSchema.parse(input);
  const r = await vender(datos, await actorDe(usuario), {
    puedeEditar: puede(usuario, Modulo.VENTAS, "editar"),
  });
  revalidar(r.id, datos.venta.clienteId);
  return r;
});

/** Guardar como borrador (presupuesto / cliente que vuelve después). */
export const guardarBorradorAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.VENTAS, "crear");
  const { borradorId, venta } = z
    .object({ borradorId: id.optional(), venta: borradorVentaSchema })
    .parse(input);
  const permisos = { puedeEditar: puede(usuario, Modulo.VENTAS, "editar") };
  const actor = await actorDe(usuario);
  const r = borradorId
    ? await actualizarBorrador(borradorId, venta, actor, permisos)
    : await crearBorrador(venta, actor, permisos);
  revalidatePath("/ventas");
  return r;
});

export const descartarBorradorAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.VENTAS, "crear");
  const { ventaId } = z.object({ ventaId: id }).parse(input);
  await descartarBorrador(ventaId, await actorDe(usuario));
  revalidatePath("/ventas");
});

export const registrarPagoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.VENTAS, "editar");
  const { ventaId, pago } = registrarPagoSchema.parse(input);
  const r = await registrarPago(ventaId, pago, await actorDe(usuario));
  revalidar(ventaId);
  return r;
});

export const pagoACuentaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.VENTAS, "editar");
  const datos = pagoACuentaSchema.parse(input);
  const r = await pagarACuenta(datos, await actorDe(usuario));
  revalidar(undefined, datos.clienteId);
  return r;
});

export const anularPagoAction = actionHandler(async (input: unknown) => {
  const usuario = await requireOwner();
  const { pagoId, motivo } = anularPagoSchema.parse(input);
  await anularPago(pagoId, motivo, await actorDe(usuario));
  revalidar();
});

export const anularVentaAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.VENTAS, "eliminar");
  const { ventaId, motivo } = anularVentaSchema.parse(input);
  const r = await anularVenta(ventaId, motivo, await actorDe(usuario));
  revalidar(ventaId);
  return r;
});

export const devolucionAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermiso(Modulo.VENTAS, "editar");
  const datos = devolucionSchema.parse(input);
  const r = await crearDevolucion(datos, await actorDe(usuario));
  revalidar(datos.ventaId);
  return r;
});

// --- Datos para el POS (sin costos: el vendedor no los necesita) ---------------------

export interface VariantePos {
  varianteId: string;
  nombreCompleto: string;
  sku: string;
  codigoBarras: string | null;
  precioVenta: string;
  stock: number;
}

export const buscarProductosPosAction = actionHandler(
  async (input: unknown): Promise<VariantePos[]> => {
    await requirePermiso(Modulo.VENTAS, "crear");
    const { q, depositoId } = z.object({ q: z.string().max(100), depositoId: id }).parse(input);
    const r = await buscarVariantes(q, { depositoId, limite: 15 });
    return r.map((v) => ({
      varianteId: v.id,
      nombreCompleto: v.nombreCompleto,
      sku: v.sku,
      codigoBarras: v.codigoBarras,
      precioVenta: v.precioVenta,
      stock: v.stockDeposito ?? 0,
    }));
  },
);

/** Precio y stock actuales de lo que está en el carrito (al cambiar de depósito y antes de cobrar). */
export const variantesPosAction = actionHandler(async (input: unknown): Promise<VariantePos[]> => {
  await requirePermiso(Modulo.VENTAS, "crear");
  const { ids, depositoId } = z.object({ ids: z.array(id).max(300), depositoId: id }).parse(input);
  const r = await obtenerVariantesPorId(ids, depositoId);
  return r.map((v) => ({
    varianteId: v.id,
    nombreCompleto: v.nombreCompleto,
    sku: v.sku,
    codigoBarras: v.codigoBarras,
    precioVenta: v.precioVenta,
    stock: v.stockDeposito ?? 0,
  }));
});

export const productosRapidosAction = actionHandler(async (input: unknown) => {
  await requirePermiso(Modulo.VENTAS, "crear");
  const { depositoId } = z.object({ depositoId: id }).parse(input);
  return productosRapidos(depositoId);
});

export const buscarClientesAction = actionHandler(async (input: unknown) => {
  await requirePermisoAlguno([Modulo.VENTAS, Modulo.CLIENTES], "ver");
  const { q } = z.object({ q: z.string().max(100) }).parse(input);
  return buscarClientesPos(q);
});

export const clientePosAction = actionHandler(async (input: unknown) => {
  await requirePermisoAlguno([Modulo.VENTAS, Modulo.CLIENTES], "ver");
  const { id: clienteId } = z.object({ id }).parse(input);
  return obtenerClientePos(clienteId);
});

/** "Crear rápido" desde el POS: sin límite de crédito (eso lo define el dueño en la ficha). */
export const crearClienteRapidoAction = actionHandler(async (input: unknown) => {
  const usuario = await requirePermisoAlguno([Modulo.CLIENTES, Modulo.VENTAS], "crear");
  const datos = crearClienteSchema.parse(input);
  const c = await crearCliente({ ...datos, limiteCredito: undefined }, await actorDe(usuario), {
    puedeDefinirLimite: false,
  });
  revalidatePath("/clientes");
  const pos = await obtenerClientePos(c.id);
  if (!pos) throw new Error("No se pudo leer el cliente recién creado");
  return pos;
});
