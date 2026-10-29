import { Prisma } from "@prisma/client";

import { tieneMercadoLibre } from "@/lib/medios-pago";
import { precioVentaEfectivo, precioVentaMLEfectivo } from "@/lib/precios";
import { nombreConSabor } from "@/lib/ventas-ui";
import { dbPara, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { obtenerCotizacion } from "@/server/services/cambio.service";
import {
  obtenerConfigCotizacion,
  obtenerConfigVentas,
} from "@/server/services/configuracion.service";

/**
 * MOTOR DE PRECIOS DEL COTIZADOR
 *
 * - UNITARIA: cada sabor a su precio de lista (precioVentaEfectivo), en pesos.
 * - MAYORISTA: el escalón sale de las unidades que cuentan para cada producto:
 *   · PEDIDO SURTIDO (`surtido`, el default del panel: Configuración del
 *     cotizador): las del pedido entero, mezclando modelos. 10 Elf Bar + 20
 *     Ignite = 30 → cada producto a SU precio del escalón de 30 (cada uno con
 *     su propia tabla de escalones).
 *   · POR PRODUCTO (surtido apagado): solo las de sus sabores (20 Mango + 35
 *     Frutilla = 55 del producto → los dos al escalón de 50); dos productos
 *     distintos de 30 u. cada uno NO entran en el escalón de 50.
 *   El escalón es el de mayor cantidadMinima ≤ esas unidades:
 *     1. escalones propios activos del producto → su precio, en su moneda:
 *        USD (dólar blue venta, el default) → pesos = USD × blue, redondeado a
 *        10 pesos; ARS → tal cual;
 *     2. si no tiene, los escalones default del panel (porcentaje) → lista ×
 *        (1 − %), redondeado a 10 pesos;
 *     3. si ninguno aplica, precio de lista.
 *   `proximoEscalon` dice cuántas unidades faltan para el siguiente y a qué precio.
 * - `precioManual` pisa todo (solo con "editar" en COTIZADOR); en mayorista se
 *   puede cargar en USD (`monedaManual`) y se convierte con el mismo blue.
 * - El blue lo pone quien llama: el vigente (cambio.service) o el snapshot de
 *   una cotización todavía vigente (sus pesos no cambian aunque cambie el blue).
 *
 * `resolverPrecios` es PURA (sin DB) y la usan los tests; `calcularPrecios`
 * junta los datos del panel y la llama.
 */

type Monto = Prisma.Decimal.Value;
const D = (v: Monto) => new Prisma.Decimal(v);
const dec = (d: Prisma.Decimal) => d.toFixed(2);

export type TipoPrecio = "UNITARIA" | "MAYORISTA";
export type MonedaPrecio = "USD" | "ARS";

export const MENSAJE_SIN_BLUE =
  "No hay cotización del dólar blue: cargala a mano en Configuración → Cotizaciones para cotizar en dólares.";

/** Redondeo a 10 pesos (mitad hacia arriba). */
function redondear10(v: Prisma.Decimal): Prisma.Decimal {
  return v.div(10).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).mul(10);
}

/** lista × (1 − %/100), redondeado a 10 pesos. */
export function precioConDescuento(precioLista: Monto, porcentaje: Monto): Prisma.Decimal {
  return redondear10(
    D(precioLista)
      .mul(D(100).minus(D(porcentaje)))
      .div(100),
  );
}

/** Dólares → pesos con el blue venta, redondeado a 10 pesos. */
export function pesosDesdeUSD(usd: Monto, blue: Monto): Prisma.Decimal {
  return redondear10(D(usd).mul(D(blue)));
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
  /** Moneda del precio manual (USD solo en mayorista). Default ARS. */
  monedaManual?: MonedaPrecio;
  stockTotal?: number;
}

export interface DatosResolverPrecios {
  tipo: TipoPrecio;
  items: ItemAResolver[];
  /** Escalones propios por producto (los inactivos se ignoran). Moneda default ARS. */
  escalones: {
    productoId: string;
    cantidadMinima: number;
    precioUnitario: Monto;
    moneda?: MonedaPrecio;
    activo?: boolean;
  }[];
  /** Escalones default del panel (los inactivos se ignoran). */
  defaults: { cantidadMinima: number; porcentajeDescuento: Monto; activo?: boolean }[];
  /** Dólar blue venta (pesos por dólar). Hace falta si aplica algún precio en USD. */
  blue?: Monto | null;
  /** Pedido surtido: el escalón lo definen las unidades de TODO el pedido (default false). */
  surtido?: boolean;
}

export interface ProximoEscalon {
  cantidadMinima: number;
  /** En pesos (null si es en USD y no hay cotización del blue). */
  precioUnitario: string | null;
  precioUnitarioUSD: string | null;
  faltan: number;
}

export interface ItemPrecio {
  varianteId: string;
  productoId: string;
  titulo: string;
  cantidad: number;
  precioLista: string;
  /** Siempre en pesos. */
  precioUnitario: string;
  /** En dólares si salió de un escalón en USD o de un precio manual en USD. */
  precioUnitarioUSD: string | null;
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
  /** Unidades del producto (todos sus sabores). Sin surtido son las que definen su escalón. */
  unidades: number;
  escalonAplicado: number | null;
  precioUnitario: string;
  precioUnitarioUSD: string | null;
}

export interface TipoCambioUsado {
  /** Pesos por dólar (blue venta). */
  valor: string;
  obtenidoAt: string;
  fuente: string | null;
  esManual: boolean;
}

export interface ResultadoPrecios {
  items: ItemPrecio[];
  subtotal: string;
  /** Equivalente en dólares del subtotal (mayorista con blue): USD exactos + pesos ÷ blue. */
  subtotalUSD: string | null;
  resumenEscalones: ResumenEscalon[];
  /** Mayorista como pedido surtido: el escalón lo definen las unidades de todo el pedido. */
  surtido: boolean;
  /** Unidades de todo el pedido. */
  unidadesPedido: number;
  /** Blue usado (solo mayorista). */
  tipoCambioBlue: TipoCambioUsado | null;
  /** Unitaria cotizada a precio Mercado Libre. */
  aPrecioML: boolean;
}

interface Escalon {
  cantidadMinima: number;
  /** En pesos (null: escalón en USD sin cotización del blue). */
  precio: Prisma.Decimal | null;
  precioUSD: Prisma.Decimal | null;
}

/**
 * Tabla de escalones efectiva para un sabor (propios del producto, en su
 * moneda, o defaults sobre su lista). Con escalones en USD y sin `blue`, el
 * precio en pesos queda null.
 */
export function tablaEfectiva(
  productoId: string,
  precioLista: Monto,
  escalones: DatosResolverPrecios["escalones"],
  defaults: DatosResolverPrecios["defaults"],
  blue: Monto | null = null,
): { origen: "PROPIOS" | "DEFAULT" | "LISTA"; moneda: MonedaPrecio; escalones: Escalon[] } {
  const propiosFilas = escalones.filter((e) => e.productoId === productoId && e.activo !== false);
  if (propiosFilas.length) {
    const moneda: MonedaPrecio = propiosFilas.some((e) => e.moneda === "USD") ? "USD" : "ARS";
    const propios = propiosFilas
      .map((e): Escalon => {
        const valor = D(e.precioUnitario);
        if (e.moneda === "USD")
          return {
            cantidadMinima: e.cantidadMinima,
            precio: blue ? pesosDesdeUSD(valor, blue) : null,
            precioUSD: valor,
          };
        return { cantidadMinima: e.cantidadMinima, precio: valor, precioUSD: null };
      })
      .sort((a, b) => a.cantidadMinima - b.cantidadMinima);
    return { origen: "PROPIOS", moneda, escalones: propios };
  }
  const porDefecto = defaults
    .filter((d) => d.activo !== false)
    .map((d): Escalon => ({
      cantidadMinima: d.cantidadMinima,
      precio: precioConDescuento(precioLista, d.porcentajeDescuento),
      precioUSD: null,
    }))
    .sort((a, b) => a.cantidadMinima - b.cantidadMinima);
  if (porDefecto.length) return { origen: "DEFAULT", moneda: "ARS", escalones: porDefecto };
  return { origen: "LISTA", moneda: "ARS", escalones: [] };
}

export function resolverPrecios(
  datos: DatosResolverPrecios,
): Omit<ResultadoPrecios, "tipoCambioBlue" | "aPrecioML"> {
  const mayorista = datos.tipo === "MAYORISTA";
  const surtido = mayorista && datos.surtido === true;
  const blue =
    datos.blue !== undefined && datos.blue !== null && D(datos.blue).greaterThan(0)
      ? D(datos.blue)
      : null;
  // Unidades POR PRODUCTO (todos sus sabores) y del pedido entero (surtido).
  const porProducto = new Map<string, number>();
  for (const i of datos.items)
    porProducto.set(i.productoId, (porProducto.get(i.productoId) ?? 0) + i.cantidad);
  const unidadesPedido = datos.items.reduce((a, i) => a + i.cantidad, 0);
  const unidadesDe = (productoId: string) => porProducto.get(productoId) ?? 0;
  /** Las que definen el escalón del producto. */
  const unidadesEscalon = (productoId: string) =>
    surtido ? unidadesPedido : unidadesDe(productoId);

  const items: ItemPrecio[] = datos.items.map((i) => {
    const lista = D(i.precioLista);
    let precio = lista;
    let precioUSD: Prisma.Decimal | null = null;
    let escalonAplicado: number | null = null;
    let proximo: ProximoEscalon | undefined;
    const manual = i.precioManual !== undefined && i.precioManual !== null;
    if (manual) {
      const valor = D(i.precioManual!).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (i.monedaManual === "USD") {
        if (!mayorista)
          throw new DomainError("En la cotización por unidad los precios son en pesos.");
        if (!blue) throw new DomainError(MENSAJE_SIN_BLUE);
        precioUSD = valor;
        precio = pesosDesdeUSD(valor, blue);
      } else {
        precio = valor;
      }
    } else if (mayorista) {
      const unidades = unidadesEscalon(i.productoId);
      const { escalones } = tablaEfectiva(
        i.productoId,
        lista,
        datos.escalones,
        datos.defaults,
        blue,
      );
      const aplicado = [...escalones].reverse().find((e) => e.cantidadMinima <= unidades);
      if (aplicado) {
        if (!aplicado.precio) throw new DomainError(MENSAJE_SIN_BLUE);
        precio = aplicado.precio;
        precioUSD = aplicado.precioUSD;
        escalonAplicado = aplicado.cantidadMinima;
      }
      const siguiente = escalones.find((e) => e.cantidadMinima > unidades);
      if (siguiente) {
        proximo = {
          cantidadMinima: siguiente.cantidadMinima,
          precioUnitario: siguiente.precio ? dec(siguiente.precio) : null,
          precioUnitarioUSD: siguiente.precioUSD ? dec(siguiente.precioUSD) : null,
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
      precioUnitarioUSD: precioUSD ? dec(precioUSD) : null,
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
        precioUnitarioUSD: referencia.precioUnitarioUSD,
      });
    }
  }

  const subtotal = items.reduce((a, i) => a.plus(i.subtotal), D(0));
  return {
    items,
    subtotal: dec(subtotal),
    subtotalUSD: mayorista && blue ? dec(totalEnUSD(items, blue)) : null,
    resumenEscalones,
    surtido,
    unidadesPedido,
  };
}

/** Σ cantidad × (USD exacto si lo tiene, si no pesos ÷ blue), a 2 decimales. */
export function totalEnUSD(
  items: { cantidad: number; precioUnitario: Monto; precioUnitarioUSD: Monto | null }[],
  blue: Monto,
): Prisma.Decimal {
  return items
    .reduce(
      (a, i) =>
        a.plus(
          (i.precioUnitarioUSD !== null
            ? D(i.precioUnitarioUSD)
            : D(i.precioUnitario).div(D(blue))
          ).mul(i.cantidad),
        ),
      D(0),
    )
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// =============================================================================
// Con datos del panel
// =============================================================================

export interface PedidoPrecios {
  tipo: TipoPrecio;
  items: {
    varianteId: string;
    cantidad: number;
    precioManual?: number | string | null;
    monedaManual?: MonedaPrecio;
  }[];
  /**
   * Solo UNITARIA: cotizar a precio Mercado Libre (cada sabor a su precio ML;
   * los que no tienen, a lista). El panel tiene que cobrar por Mercado Libre.
   */
  aPrecioML?: boolean;
}

export interface OpcionesPrecios {
  /**
   * Blue a usar en vez del vigente: el snapshot de una cotización todavía
   * vigente (lo que se le prometió al cliente no cambia con el blue).
   */
  tipoCambioBlue?: { valor: Monto; obtenidoAt: Date | string } | null;
}

/** Blue venta vigente (override manual o automático) en el formato del resultado. */
async function blueVigente(): Promise<TipoCambioUsado | null> {
  const c = await obtenerCotizacion("USD_BLUE", "VENTA");
  if (!c) return null;
  return {
    valor: D(c.valor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    obtenidoAt: c.obtenidoAt,
    fuente: c.fuente,
    esManual: c.esManual,
  };
}

/**
 * Calcula los precios de una cotización con los datos actuales del panel
 * (listas, escalones, defaults, stock total) y, en mayorista, el dólar blue
 * (el vigente o el snapshot de `opciones`). Acepta el `tx` de una transacción
 * en curso (crear/actualizar/convertir).
 */
export async function calcularPrecios(
  ctx: Ctx,
  pedido: PedidoPrecios,
  permisos: { puedeEditar: boolean },
  tx: Tx = dbPara(ctx.panelId),
  opciones: OpcionesPrecios = {},
): Promise<ResultadoPrecios> {
  const ids = pedido.items.map((i) => i.varianteId);
  if (new Set(ids).size !== ids.length)
    throw new DomainError("Hay productos repetidos: sumá la cantidad en una sola fila.");
  const mayorista = pedido.tipo === "MAYORISTA";
  const aPrecioML = pedido.aPrecioML === true && !mayorista;
  if (aPrecioML && !tieneMercadoLibre(await obtenerConfigVentas(ctx, tx)))
    throw new DomainError("Este panel no cobra por Mercado Libre: no hay precios Mercado Libre.");
  for (const i of pedido.items) {
    if (!Number.isInteger(i.cantidad) || i.cantidad <= 0)
      throw new DomainError("Las cantidades tienen que ser enteros mayores a 0.");
    if (i.precioManual !== undefined && i.precioManual !== null) {
      if (!permisos.puedeEditar)
        throw new ForbiddenError("No tenés permiso para poner precios a mano.");
      if (D(i.precioManual).isNegative()) throw new DomainError("El precio no puede ser negativo.");
      if (i.monedaManual === "USD" && !mayorista)
        throw new DomainError("En la cotización por unidad los precios son en pesos.");
    }
  }
  const surtido = mayorista && (await obtenerConfigCotizacion(ctx, tx)).pedidoSurtido;
  const tipoCambioBlue: TipoCambioUsado | null = !mayorista
    ? null
    : opciones.tipoCambioBlue
      ? {
          valor: D(opciones.tipoCambioBlue.valor).toFixed(2),
          obtenidoAt: new Date(opciones.tipoCambioBlue.obtenidoAt).toISOString(),
          fuente: null,
          esManual: false,
        }
      : await blueVigente();
  if (ids.length === 0) {
    return {
      items: [],
      subtotal: "0.00",
      subtotalUSD: mayorista && tipoCambioBlue ? "0.00" : null,
      resumenEscalones: [],
      surtido,
      unidadesPedido: 0,
      tipoCambioBlue,
      aPrecioML,
    };
  }

  const variantes = await tx.variante.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      nombre: true,
      activo: true,
      productoId: true,
      precioVenta: true,
      precioVentaML: true,
      producto: {
        select: {
          nombreCompleto: true,
          precioVenta: true,
          precioVentaML: true,
          activo: true,
          deletedAt: true,
        },
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
    mayorista
      ? tx.escalonPrecio.findMany({
          where: { productoId: { in: productoIds }, activo: true },
          select: { productoId: true, cantidadMinima: true, precioUnitario: true, moneda: true },
        })
      : Promise.resolve([]),
    mayorista
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
      precioLista:
        (aPrecioML ? precioVentaMLEfectivo(v, v.producto) : null) ??
        precioVentaEfectivo(v, v.producto),
      precioManual: i.precioManual ?? null,
      monedaManual: i.monedaManual ?? "ARS",
      stockTotal: stockDe.get(v.id) ?? 0,
    };
  });

  return {
    ...resolverPrecios({
      tipo: pedido.tipo,
      items,
      escalones,
      defaults,
      blue: tipoCambioBlue?.valor ?? null,
      surtido,
    }),
    tipoCambioBlue,
    aPrecioML,
  };
}
