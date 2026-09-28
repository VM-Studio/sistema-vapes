import { Prisma } from "@prisma/client";

import { precioVentaEfectivo } from "@/lib/precios";
import type { ModoEscalon } from "@/lib/validations/cotizacion";
import { nombreConSabor } from "@/lib/ventas-ui";
import { dbPara, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { obtenerConfigCotizacion } from "@/server/services/configuracion.service";

/**
 * MOTOR DE PRECIOS DEL COTIZADOR
 *
 * - UNITARIA: cada sabor a su precio de lista (precioVentaEfectivo).
 * - MAYORISTA: las unidades se agrupan por producto (todos sus sabores: 20
 *   Mango + 35 Frutilla = 55 del producto) o, en modo POR_TOTAL, las de toda
 *   la cotización definen el escalón de todos los productos. El escalón es el
 *   de mayor cantidadMinima ≤ unidades:
 *     1. escalones propios activos del producto → su precio;
 *     2. si no tiene, los escalones default del panel → lista × (1 − %),
 *        redondeado a 10 pesos;
 *     3. si ninguno aplica, precio de lista.
 *   `proximoEscalon` dice cuántas unidades faltan para el siguiente y a qué precio.
 * - `precioManual` pisa todo (solo con "editar" en COTIZADOR).
 *
 * `resolverPrecios` es PURA (sin DB) y la usan los tests; `calcularPrecios`
 * junta los datos del panel y la llama.
 */

type Monto = Prisma.Decimal.Value;
const D = (v: Monto) => new Prisma.Decimal(v);
const dec = (d: Prisma.Decimal) => d.toFixed(2);

export type TipoPrecio = "UNITARIA" | "MAYORISTA";

/** lista × (1 − %/100), redondeado a 10 pesos. */
export function precioConDescuento(precioLista: Monto, porcentaje: Monto): Prisma.Decimal {
  const bruto = D(precioLista)
    .mul(D(100).minus(D(porcentaje)))
    .div(100);
  return bruto.div(10).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).mul(10);
}

export interface ItemAResolver {
  varianteId: string;
  productoId: string;
  /** "Elf Bar BC 5000 — Mango Ice". */
  titulo: string;
  /** Nombre del producto (resumen de escalones). */
  nombreCompleto: string;
  cantidad: number;
  precioLista: Monto;
  precioManual?: Monto | null;
  stockTotal?: number;
}

export interface DatosResolverPrecios {
  tipo: TipoPrecio;
  modo: ModoEscalon;
  items: ItemAResolver[];
  /** Escalones propios por producto (los inactivos se ignoran). */
  escalones: {
    productoId: string;
    cantidadMinima: number;
    precioUnitario: Monto;
    activo?: boolean;
  }[];
  /** Escalones default del panel (los inactivos se ignoran). */
  defaults: { cantidadMinima: number; porcentajeDescuento: Monto; activo?: boolean }[];
}

export interface ProximoEscalon {
  cantidadMinima: number;
  precioUnitario: string;
  faltan: number;
}

export interface ItemPrecio {
  varianteId: string;
  productoId: string;
  titulo: string;
  cantidad: number;
  precioLista: string;
  precioUnitario: string;
  /** cantidadMinima del escalón aplicado (null = lista o precio manual). */
  escalonAplicado: number | null;
  esPrecioManual: boolean;
  subtotal: string;
  stockTotal: number;
  proximoEscalon?: ProximoEscalon;
}

export interface ResumenEscalon {
  productoId: string;
  nombreCompleto: string;
  /** Unidades que definen el escalón (del producto, o de toda la cotización en POR_TOTAL). */
  unidades: number;
  escalonAplicado: number | null;
  precioUnitario: string;
}

export interface ResultadoPrecios {
  items: ItemPrecio[];
  subtotal: string;
  resumenEscalones: ResumenEscalon[];
  modo: ModoEscalon;
}

interface Escalon {
  cantidadMinima: number;
  precio: Prisma.Decimal;
}

/** Tabla de escalones efectiva para un sabor (propios del producto o defaults sobre su lista). */
export function tablaEfectiva(
  productoId: string,
  precioLista: Monto,
  escalones: DatosResolverPrecios["escalones"],
  defaults: DatosResolverPrecios["defaults"],
): { origen: "PROPIOS" | "DEFAULT" | "LISTA"; escalones: Escalon[] } {
  const propios = escalones
    .filter((e) => e.productoId === productoId && e.activo !== false)
    .map((e) => ({ cantidadMinima: e.cantidadMinima, precio: D(e.precioUnitario) }))
    .sort((a, b) => a.cantidadMinima - b.cantidadMinima);
  if (propios.length) return { origen: "PROPIOS", escalones: propios };
  const porDefecto = defaults
    .filter((d) => d.activo !== false)
    .map((d) => ({
      cantidadMinima: d.cantidadMinima,
      precio: precioConDescuento(precioLista, d.porcentajeDescuento),
    }))
    .sort((a, b) => a.cantidadMinima - b.cantidadMinima);
  if (porDefecto.length) return { origen: "DEFAULT", escalones: porDefecto };
  return { origen: "LISTA", escalones: [] };
}

export function resolverPrecios(datos: DatosResolverPrecios): ResultadoPrecios {
  const mayorista = datos.tipo === "MAYORISTA";
  const porProducto = new Map<string, number>();
  let totalUnidades = 0;
  for (const i of datos.items) {
    porProducto.set(i.productoId, (porProducto.get(i.productoId) ?? 0) + i.cantidad);
    totalUnidades += i.cantidad;
  }
  const unidadesDe = (productoId: string) =>
    datos.modo === "POR_TOTAL" ? totalUnidades : (porProducto.get(productoId) ?? 0);

  const items: ItemPrecio[] = datos.items.map((i) => {
    const lista = D(i.precioLista);
    let precio = lista;
    let escalonAplicado: number | null = null;
    let proximo: ProximoEscalon | undefined;
    const manual = i.precioManual !== undefined && i.precioManual !== null;
    if (manual) {
      precio = D(i.precioManual!).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    } else if (mayorista) {
      const unidades = unidadesDe(i.productoId);
      const { escalones } = tablaEfectiva(i.productoId, lista, datos.escalones, datos.defaults);
      const aplicado = [...escalones].reverse().find((e) => e.cantidadMinima <= unidades);
      if (aplicado) {
        precio = aplicado.precio;
        escalonAplicado = aplicado.cantidadMinima;
      }
      const siguiente = escalones.find((e) => e.cantidadMinima > unidades);
      if (siguiente) {
        proximo = {
          cantidadMinima: siguiente.cantidadMinima,
          precioUnitario: dec(siguiente.precio),
          faltan: siguiente.cantidadMinima - unidades,
        };
      }
    }
    return {
      varianteId: i.varianteId,
      productoId: i.productoId,
      titulo: i.titulo,
      cantidad: i.cantidad,
      precioLista: dec(lista),
      precioUnitario: dec(precio),
      escalonAplicado,
      esPrecioManual: manual,
      subtotal: dec(precio.mul(i.cantidad)),
      stockTotal: i.stockTotal ?? 0,
      ...(proximo ? { proximoEscalon: proximo } : {}),
    };
  });

  const resumenEscalones: ResumenEscalon[] = [];
  if (mayorista) {
    for (const productoId of porProducto.keys()) {
      const delProducto = items.filter((it) => it.productoId === productoId);
      const referencia = delProducto.find((it) => !it.esPrecioManual) ?? delProducto[0]!;
      resumenEscalones.push({
        productoId,
        nombreCompleto: datos.items.find((i) => i.productoId === productoId)!.nombreCompleto,
        unidades: unidadesDe(productoId),
        escalonAplicado: referencia.escalonAplicado,
        precioUnitario: referencia.precioUnitario,
      });
    }
  }

  return {
    items,
    subtotal: dec(items.reduce((a, i) => a.plus(i.subtotal), D(0))),
    resumenEscalones,
    modo: datos.modo,
  };
}

// =============================================================================
// Con datos del panel
// =============================================================================

export interface PedidoPrecios {
  tipo: TipoPrecio;
  items: { varianteId: string; cantidad: number; precioManual?: number | string | null }[];
}

/**
 * Calcula los precios de una cotización con los datos actuales del panel
 * (listas, escalones, defaults, modo y stock total). Acepta el `tx` de una
 * transacción en curso (crear/actualizar/convertir).
 */
export async function calcularPrecios(
  ctx: Ctx,
  pedido: PedidoPrecios,
  permisos: { puedeEditar: boolean },
  tx: Tx = dbPara(ctx.panelId),
): Promise<ResultadoPrecios> {
  const ids = pedido.items.map((i) => i.varianteId);
  if (new Set(ids).size !== ids.length)
    throw new DomainError("Hay productos repetidos: sumá la cantidad en una sola fila.");
  for (const i of pedido.items) {
    if (!Number.isInteger(i.cantidad) || i.cantidad <= 0)
      throw new DomainError("Las cantidades tienen que ser enteros mayores a 0.");
    if (i.precioManual !== undefined && i.precioManual !== null) {
      if (!permisos.puedeEditar)
        throw new ForbiddenError("No tenés permiso para poner precios a mano.");
      if (D(i.precioManual).isNegative()) throw new DomainError("El precio no puede ser negativo.");
    }
  }
  const config = await obtenerConfigCotizacion(ctx, tx);
  if (ids.length === 0) {
    return { items: [], subtotal: "0.00", resumenEscalones: [], modo: config.modoEscalonMayorista };
  }

  const variantes = await tx.variante.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      nombre: true,
      activo: true,
      productoId: true,
      precioVenta: true,
      producto: {
        select: { nombreCompleto: true, precioVenta: true, activo: true, deletedAt: true },
      },
    },
  });
  const porId = new Map(variantes.map((v) => [v.id, v]));
  const productoIds = [...new Set(variantes.map((v) => v.productoId))];

  const [stocks, escalones, defaults] = await Promise.all([
    tx.stock.groupBy({
      by: ["varianteId"],
      where: { varianteId: { in: ids }, deposito: { activo: true } },
      _sum: { cantidad: true },
    }),
    pedido.tipo === "MAYORISTA"
      ? tx.escalonPrecio.findMany({
          where: { productoId: { in: productoIds }, activo: true },
          select: { productoId: true, cantidadMinima: true, precioUnitario: true },
        })
      : Promise.resolve([]),
    pedido.tipo === "MAYORISTA"
      ? tx.escalonPrecioDefault.findMany({
          where: { activo: true },
          select: { cantidadMinima: true, porcentajeDescuento: true },
        })
      : Promise.resolve([]),
  ]);
  const stockDe = new Map(stocks.map((s) => [s.varianteId, s._sum.cantidad ?? 0]));

  const items: ItemAResolver[] = pedido.items.map((i) => {
    const v = porId.get(i.varianteId);
    if (!v || v.producto.deletedAt)
      throw new NotFoundError("Alguno de los productos no existe o fue dado de baja.");
    const titulo = nombreConSabor(v.producto.nombreCompleto, v.nombre);
    if (!v.activo || !v.producto.activo) throw new DomainError(`${titulo} está inactivo.`);
    return {
      varianteId: v.id,
      productoId: v.productoId,
      titulo,
      nombreCompleto: v.producto.nombreCompleto,
      cantidad: i.cantidad,
      precioLista: precioVentaEfectivo(v, v.producto),
      precioManual: i.precioManual ?? null,
      stockTotal: stockDe.get(v.id) ?? 0,
    };
  });

  return resolverPrecios({
    tipo: pedido.tipo,
    modo: config.modoEscalonMayorista,
    items,
    escalones,
    defaults,
  });
}
