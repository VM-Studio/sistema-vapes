import { AccionAuditoria, Prisma } from "@prisma/client";

import { precioVentaEfectivo, tienePrecioPropio } from "@/lib/precios";
import { saborVisible } from "@/lib/ventas-ui";
import { dbPara, transaccion, type Ctx } from "@/server/db/panel-scoped";
import { NotFoundError, ValidationError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import { precioConDescuento, tablaEfectiva } from "@/server/services/precio.service";

/**
 * ESCALONES DE PRECIO MAYORISTA (por panel)
 * - Propios de un producto (EscalonPrecio): precio por unidad desde cierta
 *   cantidad, para todos sus sabores.
 * - Default del panel (EscalonPrecioDefault): % de descuento sobre la lista
 *   para los productos sin escalones propios activos.
 * Guardar REEMPLAZA el set completo. Mínimos distintos (crecientes) y, al
 * subir la cantidad, precios estrictamente menores (o % mayores).
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dec = (d: Prisma.Decimal) => d.toFixed(2);

export interface EscalonGuardado {
  id: string;
  cantidadMinima: number;
  precioUnitario: string;
  activo: boolean;
}

export interface EscalonDefaultGuardado {
  id: string;
  cantidadMinima: number;
  porcentajeDescuento: string;
  activo: boolean;
}

function validarMinimos(minimos: number[]) {
  for (const m of minimos) {
    if (!Number.isInteger(m) || m <= 0)
      throw new ValidationError("Las cantidades mínimas tienen que ser enteros mayores a 0.", {
        escalones: ["Cantidad mínima inválida"],
      });
  }
  if (new Set(minimos).size !== minimos.length)
    throw new ValidationError("Hay dos escalones con la misma cantidad mínima.", {
      escalones: ["Cantidades mínimas repetidas"],
    });
}

export async function listarEscalones(ctx: Ctx, productoId: string): Promise<EscalonGuardado[]> {
  const filas = await dbPara(ctx.panelId).escalonPrecio.findMany({
    where: { productoId },
    orderBy: { cantidadMinima: "asc" },
  });
  return filas.map((e) => ({
    id: e.id,
    cantidadMinima: e.cantidadMinima,
    precioUnitario: dec(e.precioUnitario),
    activo: e.activo,
  }));
}

export async function guardarEscalones(
  ctx: Ctx,
  productoId: string,
  escalones: { cantidadMinima: number; precioUnitario: Prisma.Decimal.Value; activo: boolean }[],
): Promise<EscalonGuardado[]> {
  const orden = [...escalones]
    .map((e) => ({ ...e, precio: D(e.precioUnitario).toDecimalPlaces(2) }))
    .sort((a, b) => a.cantidadMinima - b.cantidadMinima);
  validarMinimos(orden.map((e) => e.cantidadMinima));
  for (const [i, e] of orden.entries()) {
    if (!e.precio.greaterThan(0))
      throw new ValidationError("Los precios tienen que ser mayores a 0.", {
        escalones: ["Precio inválido"],
      });
    const anterior = orden[i - 1];
    if (anterior && !e.precio.lessThan(anterior.precio))
      throw new ValidationError(
        `Desde ${e.cantidadMinima} unidades el precio tiene que ser menor que desde ${anterior.cantidadMinima}.`,
        { escalones: ["Los precios tienen que bajar al subir la cantidad"] },
      );
  }

  await transaccion(ctx, async (tx) => {
    const producto = await tx.producto.findFirst({
      where: { id: productoId, deletedAt: null },
      select: { id: true, nombreCompleto: true },
    });
    if (!producto) throw new NotFoundError("El producto no existe o fue dado de baja.");
    const antes = await tx.escalonPrecio.findMany({
      where: { productoId },
      orderBy: { cantidadMinima: "asc" },
    });
    await tx.escalonPrecio.deleteMany({ where: { productoId } });
    if (orden.length) {
      await tx.escalonPrecio.createMany({
        data: orden.map((e) => ({
          productoId,
          cantidadMinima: e.cantidadMinima,
          precioUnitario: e.precio,
          activo: e.activo,
        })),
      });
    }
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "EscalonPrecio",
      entidadId: productoId,
      datosAntes: {
        producto: producto.nombreCompleto,
        escalones: antes.map((e) => ({
          cantidadMinima: e.cantidadMinima,
          precioUnitario: dec(e.precioUnitario),
          activo: e.activo,
        })),
      },
      datosDespues: {
        producto: producto.nombreCompleto,
        escalones: orden.map((e) => ({
          cantidadMinima: e.cantidadMinima,
          precioUnitario: dec(e.precio),
          activo: e.activo,
        })),
      },
      meta: ctx.meta,
    });
  });
  return listarEscalones(ctx, productoId);
}

export async function listarEscalonesDefault(ctx: Ctx): Promise<EscalonDefaultGuardado[]> {
  const filas = await dbPara(ctx.panelId).escalonPrecioDefault.findMany({
    orderBy: { cantidadMinima: "asc" },
  });
  return filas.map((e) => ({
    id: e.id,
    cantidadMinima: e.cantidadMinima,
    porcentajeDescuento: dec(e.porcentajeDescuento),
    activo: e.activo,
  }));
}

export async function guardarEscalonesDefault(
  ctx: Ctx,
  escalones: {
    cantidadMinima: number;
    porcentajeDescuento: Prisma.Decimal.Value;
    activo: boolean;
  }[],
): Promise<EscalonDefaultGuardado[]> {
  const orden = [...escalones]
    .map((e) => ({ ...e, pct: D(e.porcentajeDescuento).toDecimalPlaces(2) }))
    .sort((a, b) => a.cantidadMinima - b.cantidadMinima);
  validarMinimos(orden.map((e) => e.cantidadMinima));
  for (const [i, e] of orden.entries()) {
    if (e.pct.lessThan(0) || e.pct.greaterThan(100))
      throw new ValidationError("El descuento tiene que estar entre 0 y 100 %.", {
        escalones: ["Porcentaje inválido"],
      });
    const anterior = orden[i - 1];
    if (anterior && !e.pct.greaterThan(anterior.pct))
      throw new ValidationError(
        `Desde ${e.cantidadMinima} unidades el descuento tiene que ser mayor que desde ${anterior.cantidadMinima}.`,
        { escalones: ["El descuento tiene que subir al subir la cantidad"] },
      );
  }

  await transaccion(ctx, async (tx) => {
    const antes = await tx.escalonPrecioDefault.findMany({ orderBy: { cantidadMinima: "asc" } });
    await tx.escalonPrecioDefault.deleteMany({});
    if (orden.length) {
      await tx.escalonPrecioDefault.createMany({
        data: orden.map((e) => ({
          cantidadMinima: e.cantidadMinima,
          porcentajeDescuento: e.pct,
          activo: e.activo,
        })),
      });
    }
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "EscalonPrecioDefault",
      entidadId: ctx.panelId,
      datosAntes: {
        escalones: antes.map((e) => ({
          cantidadMinima: e.cantidadMinima,
          porcentajeDescuento: dec(e.porcentajeDescuento),
          activo: e.activo,
        })),
      },
      datosDespues: {
        escalones: orden.map((e) => ({
          cantidadMinima: e.cantidadMinima,
          porcentajeDescuento: dec(e.pct),
          activo: e.activo,
        })),
      },
      meta: ctx.meta,
    });
  });
  return listarEscalonesDefault(ctx);
}

export interface TablaPreciosProducto {
  productoId: string;
  nombreCompleto: string;
  precioLista: string;
  /** De dónde salen los escalones: propios del producto, defaults del panel o solo lista. */
  origen: "PROPIOS" | "DEFAULT" | "LISTA";
  escalones: {
    cantidadMinima: number;
    precioUnitario: string;
    /** Descuento respecto de la lista, en % con 2 decimales. */
    descuento: string;
  }[];
  /** Sabores con precio propio: los defaults se aplican sobre su lista. */
  saboresConPrecioPropio: {
    varianteId: string;
    sabor: string | null;
    precioLista: string;
    escalones: { cantidadMinima: number; precioUnitario: string }[];
  }[];
}

/** Lista + escalones efectivos con su precio resultante ("Ver tabla de precios"). */
export async function tablaPreciosProducto(
  ctx: Ctx,
  productoId: string,
): Promise<TablaPreciosProducto> {
  const db = dbPara(ctx.panelId);
  const producto = await db.producto.findFirst({
    where: { id: productoId, deletedAt: null },
    select: {
      id: true,
      nombreCompleto: true,
      precioVenta: true,
      variantes: {
        where: { deletedAt: null },
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true, precioVenta: true },
      },
    },
  });
  if (!producto) throw new NotFoundError("El producto no existe o fue dado de baja.");
  const [escalones, defaults] = await Promise.all([
    db.escalonPrecio.findMany({
      where: { productoId, activo: true },
      select: { productoId: true, cantidadMinima: true, precioUnitario: true },
    }),
    db.escalonPrecioDefault.findMany({
      where: { activo: true },
      select: { cantidadMinima: true, porcentajeDescuento: true },
    }),
  ]);
  const lista = D(producto.precioVenta);
  const tabla = tablaEfectiva(productoId, lista, escalones, defaults);
  const descuento = (precio: Prisma.Decimal) =>
    lista.isZero() ? "0.00" : dec(D(1).minus(precio.div(lista)).mul(100));
  return {
    productoId,
    nombreCompleto: producto.nombreCompleto,
    precioLista: dec(lista),
    origen: tabla.origen,
    escalones: tabla.escalones.map((e) => ({
      cantidadMinima: e.cantidadMinima,
      precioUnitario: dec(e.precio),
      descuento: descuento(e.precio),
    })),
    saboresConPrecioPropio: producto.variantes.filter(tienePrecioPropio).map((v) => {
      const propia = precioVentaEfectivo(v, producto);
      return {
        varianteId: v.id,
        sabor: saborVisible(v.nombre),
        precioLista: dec(D(propia)),
        escalones:
          tabla.origen === "DEFAULT"
            ? defaults
                .map((d) => ({
                  cantidadMinima: d.cantidadMinima,
                  precioUnitario: dec(precioConDescuento(propia, d.porcentajeDescuento)),
                }))
                .sort((a, b) => a.cantidadMinima - b.cantidadMinima)
            : tabla.escalones.map((e) => ({
                cantidadMinima: e.cantidadMinima,
                precioUnitario: dec(e.precio),
              })),
      };
    }),
  };
}
