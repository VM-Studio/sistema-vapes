"use server";

import { Modulo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { puede } from "@/lib/permisos";
import { id } from "@/lib/validations/common";
import {
  anularVentaSchema,
  generarVentaSchema,
  marcarPagadaSchema,
  ventaIdSchema,
} from "@/lib/validations/venta";
import { actionHandler } from "@/server/action-handler";
import { requireCtx } from "@/server/auth/permissions";
import { ClienteDuplicadoError, type ClienteBasico } from "@/server/services/cliente.service";
import { cancelarEscaneo, pedirEscaneo } from "@/server/services/escaneo-remoto.service";
import { cobrarVenta } from "@/server/services/fiado.service";
import {
  anularVenta,
  generarVenta,
  preciosMercadoLibre,
  productosMasVendidos,
  stockEnDeposito,
  unidadesPorDeposito,
  type VentaGenerada,
} from "@/server/services/venta.service";

/**
 * Permisos de VENTAS (en el panel actual):
 *   ver → listado y detalle · crear → generar ventas (y dar de alta al cliente nuevo)
 *   editar → precio especial y descuento global · eliminar → anular ventas (dueños siempre)
 * Vender fiado (pagos que no cubren el total) exige además FIADOS "crear" (lo valida el servicio).
 * Precios, costos y totales los calcula el servicio: acá solo se decide qué puede el usuario.
 */

/** Una venta generada o anulada mueve stock y aparece en la ficha del cliente. */
function revalidar() {
  revalidatePath("/p/[slug]/ventas", "layout");
  revalidatePath("/p/[slug]/stock", "layout");
  revalidatePath("/p/[slug]/productos", "layout");
  revalidatePath("/p/[slug]/clientes", "layout");
  revalidatePath("/p/[slug]/fiados", "layout");
  revalidatePath("/p/[slug]", "page");
}

export type ResultadoGenerarVenta =
  | { tipo: "ok"; venta: VentaGenerada }
  /** El teléfono del "cliente nuevo" ya es de otro cliente: la UI lo selecciona. */
  | { tipo: "cliente_duplicado"; mensaje: string; cliente: ClienteBasico };

export const generarVentaAction = actionHandler(
  async (input: unknown): Promise<ResultadoGenerarVenta> => {
    const ctx = await requireCtx(Modulo.VENTAS, "crear");
    const datos = generarVentaSchema.parse(input);
    try {
      const venta = await generarVenta(ctx, datos, {
        puedeEditar: puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "editar"),
      });
      revalidar();
      return { tipo: "ok", venta };
    } catch (e) {
      if (e instanceof ClienteDuplicadoError) {
        return { tipo: "cliente_duplicado", mensaje: e.message, cliente: e.clienteExistente };
      }
      throw e;
    }
  },
);

/** Anular: dueños o VENTAS "eliminar" (vuelve el stock con VENTA_ANULADA y se anulan los pagos). */
export const anularVentaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "eliminar");
  const { ventaId, motivo } = anularVentaSchema.parse(input);
  const r = await anularVenta(ctx, ventaId, motivo);
  revalidar();
  return r;
});

/**
 * «Marcar pagada»: cobra el saldo (o parte) de una venta pendiente. Con VENTAS
 * "editar" o FIADOS "editar" (lo valida el servicio; acá alcanza con ver).
 */
export const marcarPagadaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "ver");
  const { ventaId, ...datos } = marcarPagadaSchema.parse(input);
  const r = await cobrarVenta(ctx, ventaId, datos);
  revalidatePath("/p/[slug]/ventas", "layout");
  revalidatePath("/p/[slug]/fiados", "layout");
  revalidatePath("/p/[slug]/clientes", "layout");
  revalidatePath("/p/[slug]", "page");
  const imputada = r.imputaciones[0];
  return {
    monto: r.monto,
    medioPago: r.medioPago,
    saldoVenta: imputada?.saldoVenta ?? "0.00",
    estadoPago: imputada?.estadoPago ?? "PAGADA",
  };
});

// --- «Escanea Charly» (galpones con escaneo remoto) ---------------------------------

/** Pedir el escaneo remoto de una venta ya generada (su vendedor o un dueño; lo valida el servicio). */
export const pedirEscaneoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const { ventaId } = ventaIdSchema.parse(input);
  const r = await pedirEscaneo(ctx, ventaId);
  revalidatePath("/p/[slug]/ventas", "layout");
  return r;
});

/** Cancelar el pedido mientras Charly no la escaneó. */
export const cancelarEscaneoAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const { ventaId } = ventaIdSchema.parse(input);
  const r = await cancelarEscaneo(ctx, ventaId);
  revalidatePath("/p/[slug]/ventas", "layout");
  return r;
});

// --- Datos para el modal (sin costos: el vendedor no los necesita) -------------------

/** Unidades totales por galpón (paso 1). */
export const unidadesPorDepositoAction = actionHandler(async () => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  return unidadesPorDeposito(ctx);
});

/** Precio Mercado Libre guardado de los sabores: sugerencia del precio a mano (paso «¿Cómo paga?»). */
export const preciosMercadoLibreAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const { ids } = z.object({ ids: z.array(id).max(300) }).parse(input);
  return preciosMercadoLibre(ctx, ids);
});

/** Stock actual de los sabores de la venta en el galpón elegido. */
export const stockVentaAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const { depositoId, ids } = z.object({ depositoId: id, ids: z.array(id).max(300) }).parse(input);
  return stockEnDeposito(ctx, depositoId, ids);
});

/** Grilla de los 12 sabores más vendidos (con su stock en el galpón). */
export const masVendidosAction = actionHandler(async (input: unknown) => {
  const ctx = await requireCtx(Modulo.VENTAS, "crear");
  const { depositoId } = z.object({ depositoId: id }).parse(input);
  return productosMasVendidos(ctx, { dias: 30, limit: 12, depositoId });
});
