"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { puede } from "@/lib/permisos";
import { id } from "@/lib/validations/common";
import {
  calcularPreciosSchema,
  clienteCotizacionSchema,
  configCotizacionSchema,
  convertirCotizacionSchema,
  crearCotizacionSchema,
  guardarEscalonesDefaultSchema,
  guardarEscalonesSchema,
  rechazarCotizacionSchema,
} from "@/lib/validations/cotizacion";
import { actionHandler } from "@/server/action-handler";
import { requireCtx, requireCtxOwner, type CtxPanel } from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/errors";
import {
  ClienteDuplicadoError,
  clientePorTelefono,
  crearCliente,
} from "@/server/services/cliente.service";
import { guardarConfigCotizacion } from "@/server/services/configuracion.service";
import {
  actualizarCotizacion,
  convertirEnVenta,
  crearCotizacion,
  duplicar,
  generarPDF,
  marcarAceptada,
  marcarEnviada,
  marcarRechazada,
  prepararConversion,
  textoWhatsApp,
} from "@/server/services/cotizacion.service";
import {
  guardarEscalones,
  guardarEscalonesDefault,
  tablaPreciosProducto,
} from "@/server/services/escalon.service";
import { calcularPrecios } from "@/server/services/precio.service";
import { productosMasVendidos } from "@/server/services/venta.service";

/**
 * Permisos del COTIZADOR (en el panel actual):
 *   ver → listado, detalle, PDF y WhatsApp · crear → armar, editar, duplicar y cambiar estado
 *   editar → precio manual por ítem y descuento global
 *   configuración y escalones por defecto → solo dueños
 *   escalones de un producto → dueños o "editar" en PRODUCTOS
 * Los precios los calcula SIEMPRE el servidor (calcularPrecios): la UI solo manda cantidades.
 */

const puedeEditarPrecios = (ctx: CtxPanel) =>
  puede(ctx.usuario, ctx.panelId, Modulo.COTIZADOR, "editar");

function revalidar() {
  revalidatePath("/p/[slug]/cotizador", "layout");
}

/** Sin "editar" no viajan precios manuales ni descuento (el servicio igual lo rechaza). */
function exigirPermisoPrecios(
  datos: { items: { precioManual?: number }[]; descuento?: number },
  puedeEditar: boolean,
) {
  if (puedeEditar) return;
  if (datos.items.some((i) => i.precioManual !== undefined) || (datos.descuento ?? 0) > 0) {
    throw new ForbiddenError("No tenés permiso para cambiar precios ni aplicar descuentos");
  }
}

// --- Armado ----------------------------------------------------------------------

/** Recalcula precios, escalones y stock de los ítems (cada cambio en el armado). */
export const calcularPreciosAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COTIZADOR, "ver");
  const puedeEditar = puedeEditarPrecios(ctx);
  const datos = calcularPreciosSchema.parse(input);
  exigirPermisoPrecios(datos, puedeEditar);
  return calcularPrecios(ctx, datos, { puedeEditar });
});

/** Crea (sin `id`) o actualiza una cotización BORRADOR/ENVIADA. */
export const guardarCotizacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COTIZADOR, "crear");
  const puedeEditar = puedeEditarPrecios(ctx);
  const { id: cotizacionId, ...datos } = crearCotizacionSchema
    .extend({ id: id.optional() })
    .parse(input);
  exigirPermisoPrecios(datos, puedeEditar);
  const r = cotizacionId
    ? await actualizarCotizacion(ctx, cotizacionId, datos, { puedeEditar })
    : await crearCotizacion(ctx, datos, { puedeEditar });
  revalidar();
  return r;
});

/** Grilla de más vendidos del armado (sin galpón: el stock se informa en total). */
export const masVendidosCotizadorAction = actionHandler(async () => {
  const ctx = await requireCtx(Modulo.COTIZADOR, "ver");
  return productosMasVendidos(ctx, { dias: 30, limit: 12 });
});

/** Sheet "Ver tabla de precios" de un producto. */
export const tablaPreciosAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COTIZADOR, "ver");
  const { productoId } = z.object({ productoId: id }).parse(input);
  return tablaPreciosProducto(ctx, productoId);
});

// --- Estado y acciones de una cotización ------------------------------------------

export const cambiarEstadoCotizacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COTIZADOR, "crear");
  const datos = rechazarCotizacionSchema
    .extend({ estado: z.enum(["ENVIADA", "ACEPTADA", "RECHAZADA"]) })
    .parse(input);
  if (datos.estado === "ENVIADA") await marcarEnviada(ctx, datos.id);
  else if (datos.estado === "ACEPTADA") await marcarAceptada(ctx, datos.id);
  else await marcarRechazada(ctx, datos.id, datos.motivo);
  revalidar();
  return { ok: true as const };
});

export const duplicarCotizacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COTIZADOR, "crear");
  const { id: cotizacionId } = z.object({ id }).parse(input);
  const r = await duplicar(ctx, cotizacionId);
  revalidar();
  return r;
});

/** Genera (o regenera) el PDF y devuelve su URL. */
export const pdfCotizacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COTIZADOR, "ver");
  const { id: cotizacionId } = z.object({ id }).parse(input);
  const r = await generarPDF(ctx, cotizacionId);
  revalidar();
  return r;
});

/** Link https://wa.me/… con el texto de la cotización (al cliente si tiene teléfono). */
export const whatsappCotizacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COTIZADOR, "ver");
  const { id: cotizacionId } = z.object({ id }).parse(input);
  const { texto, telefono } = await textoWhatsApp(ctx, cotizacionId);
  const numero = telefono ? telefono.replace(/\D/g, "") : "";
  return { url: `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` };
});

/** Qué cambia al convertir (precios recalculados si está VENCIDA). */
export const prepararConversionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.COTIZADOR, "ver");
  const { id: cotizacionId } = z.object({ id }).parse(input);
  return prepararConversion(ctx, cotizacionId);
});

/**
 * Convierte en venta desde el modal de Ventas: ítems y cliente vienen de la
 * cotización; acá solo llegan galpón y medio de pago (y el cliente, si la
 * cotización no tenía uno registrado).
 */
export const convertirCotizacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  if (!puede(ctx.usuario, ctx.panelId, Modulo.COTIZADOR, "ver")) {
    throw new ForbiddenError("No tenés acceso al cotizador");
  }
  const datos = convertirCotizacionSchema
    .omit({ clienteId: true })
    .extend({
      /** Solo si la cotización no tenía cliente: el que se eligió en el modal. */
      cliente: clienteCotizacionSchema.unwrap().optional(),
    })
    .parse(input);
  const clienteId = datos.cliente ? await resolverCliente(ctx, datos.cliente) : undefined;
  const venta = await convertirEnVenta(ctx, datos.id, {
    depositoId: datos.depositoId,
    medioPago: datos.medioPago,
    ...(clienteId ? { clienteId } : {}),
    ...(datos.recalcular ? { recalcular: true } : {}),
  });
  revalidar();
  revalidatePath("/p/[slug]/ventas", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/clientes", "layout");
  revalidatePath("/p/[slug]", "page");
  return venta;
});

/** Cliente elegido en el modal: existente, o nuevo (si el teléfono ya es de alguien, ese). */
async function resolverCliente(
  ctx: CtxPanel,
  cliente: { id: string } | { nombre: string; telefono: string },
): Promise<string> {
  if ("id" in cliente) return cliente.id;
  const existente = await clientePorTelefono(ctx, cliente.telefono);
  if (existente) return existente.id;
  try {
    return (await crearCliente(ctx, cliente)).id;
  } catch (e) {
    if (e instanceof ClienteDuplicadoError) return e.clienteExistente.id;
    throw e;
  }
}

// --- Configuración y escalones ------------------------------------------------------

export const guardarConfigCotizacionAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const datos = configCotizacionSchema.parse(input);
  const r = await guardarConfigCotizacion(ctx, datos);
  revalidar();
  return r;
});

export const guardarEscalonesDefaultAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtxOwner();
  const { escalones } = guardarEscalonesDefaultSchema.parse(input);
  const r = await guardarEscalonesDefault(ctx, escalones);
  revalidar();
  revalidatePath("/p/[slug]/productos", "layout");
  return r;
});

/** "Precios mayoristas" de la ficha del producto (dueños o editar en PRODUCTOS). */
export const guardarEscalonesProductoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.PRODUCTOS, "editar");
  const { productoId, escalones } = guardarEscalonesSchema.parse(input);
  const r = await guardarEscalones(ctx, productoId, escalones);
  revalidatePath("/p/[slug]/productos", "layout");
  revalidar();
  return r;
});
