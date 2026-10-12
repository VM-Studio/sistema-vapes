import {
  AccionAuditoria,
  EstadoCompra,
  Moneda,
  OrigenCostoVariante,
  Prisma,
  TipoMovimiento,
} from "@prisma/client";

import { calcularCostosFinales, type CostosFinales } from "@/lib/costos-compra";
import { finDelDia, hoyAR, inicioDelDia } from "@/lib/fechas";
import { formatearIdCompra } from "@/lib/paneles";
import type { Compra, FiltrosCompras } from "@/lib/validations/compra";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { siguienteNumero } from "@/server/db/secuencia";
import { DomainError, NotFoundError, StockInsuficienteError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import { obtenerCotizacion } from "@/server/services/cambio.service";
import { actualizarUltimoCosto } from "@/server/services/costo-variante.service";
import { asignarProducto } from "@/server/services/proveedor.service";
import { sincronizarComisionPasista } from "@/server/services/pasista.service";
import { registrarMovimiento } from "@/server/services/stock.service";

/**
 * COMPRAS a proveedores (por panel: numeración, proveedor y galpón del panel).
 *
 * - Proveedor y galpón destino son OBLIGATORIOS.
 * - Los totales se calculan SIEMPRE acá (nunca se confía en los del cliente);
 *   la DB además verifica subtotal = Σ ítems y total = subtotal − descuento.
 * - Cada ítem es un SABOR (varianteId) y lleva su productoId (= variante.productoId,
 *   lo verifica un trigger).
 * - El stock entra solo al RECIBIR (INGRESO_COMPRA, vía el motor de stock) y
 *   sale solo al ANULAR una recibida (DEVOLUCION_PROVEEDOR).
 * - Recibir actualiza `Variante.ultimoCosto` con el costo de la compra. Cada
 *   VENTA guarda un SNAPSHOT de ese costo al vender (`costoParaVenta` de
 *   `src/lib/precios.ts` → VentaItem.costoUnitario): cambiar el costo después
 *   no cambia la ganancia de las ventas ya hechas.
 * - Opcionalmente, recibir actualiza el precio del proveedor
 *   (ProveedorProducto) con el costo pagado. El precio del proveedor es POR
 *   PRODUCTO: si la compra trae varios sabores del mismo producto con costos
 *   distintos, gana el costo del ÚLTIMO ítem de ese producto (orden de carga).
 * - Proveedores en USDT: el costo (CompraItem.costoUnitario) es SIEMPRE en
 *   pesos. El sugerido sale de precio USDT × cotización USDT vigente; la
 *   compra guarda esa cotización (Compra.tipoCambioUSDT, snapshot tomado al
 *   crearla y conservado al editar el borrador) y, para los productos que el
 *   proveedor cotiza en USDT, el costo en USDT (CompraItem.costoUnitarioUSDT =
 *   costo en pesos ÷ snapshot) para trazabilidad. Todo se calcula acá.
 * - COSTO FINAL (Bloque 6): comisión del pasista (% sobre el total, tick en la
 *   compra) + gastos extras (GastoCompra: valija, envío…) se prorratean POR
 *   UNIDAD (calcularCostosFinales en src/lib/costos-compra.ts, ahí está el
 *   porqué) → CompraItem.costoUnitarioFinal. `recalcularCostosFinales` corre
 *   al crear/editar, al cambiar el tick y al agregar/anular gastos; en una
 *   compra RECIBIDA además pasa el costo final a `Variante.ultimoCosto` de los
 *   sabores cuya última compra recibida es esta (historial en
 *   CostoVarianteHistorial). Recibir usa el costo final, no el base.
 * - Comisión del pasista (módulo Pasista): cada cambio de la comisión de la
 *   compra se refleja en ComisionPasista en la misma transacción
 *   (sincronizarComisionPasista en pasista.service).
 * - Una compra recibida no se edita (lo garantiza la DB): se anula. Lo único
 *   que cambia después es la comisión, los gastos y lo que se calcula de ellos.
 * - Costos y totales: solo dueños o `ver` en COMPRAS (el módulo entero ya lo exige).
 */

const dec = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);

async function slugDelPanel(tx: Tx, panelId: string): Promise<string> {
  const panel = await tx.panel.findUnique({ where: { id: panelId }, select: { slug: true } });
  if (!panel) throw new NotFoundError("El panel no existe");
  return panel.slug;
}

// =============================================================================
// Totales
// =============================================================================

export interface TotalesCompra {
  items: {
    varianteId: string;
    cantidad: number;
    costoUnitario: Prisma.Decimal;
    subtotal: Prisma.Decimal;
  }[];
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

export { calcularCostosFinales };

/** subtotal ítem = cantidad × costo · total = Σ ítems. */
export function calcularTotalesCompra(datos: Pick<Compra, "items">): TotalesCompra {
  const items = datos.items.map((i) => {
    const costoUnitario = new Prisma.Decimal(i.costoUnitario).toDecimalPlaces(2);
    return {
      varianteId: i.varianteId,
      cantidad: i.cantidad,
      costoUnitario,
      subtotal: costoUnitario.mul(i.cantidad),
    };
  });
  const subtotal = items.reduce((acc, i) => acc.plus(i.subtotal), new Prisma.Decimal(0));
  return { items, subtotal, total: subtotal };
}

async function bloquearCompra(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Compra" WHERE "id" = ${id} AND "panelId" = ${ctx.panelId} FOR UPDATE`;
}

/** Valida proveedor y galpón (del panel, activos) y devuelve el productoId de cada sabor. */
async function validarReferencias(tx: Tx, datos: Compra): Promise<Map<string, string>> {
  if (!datos.proveedorId) throw new DomainError("Elegí el proveedor de la compra");
  if (!datos.depositoId) throw new DomainError("Elegí el galpón donde entra la mercadería");
  const [deposito, proveedor, variantes] = await Promise.all([
    tx.deposito.findUnique({
      where: { id: datos.depositoId },
      select: { activo: true, nombre: true },
    }),
    tx.proveedor.findFirst({
      where: { id: datos.proveedorId, deletedAt: null },
      select: { activo: true, nombre: true },
    }),
    tx.variante.findMany({
      where: {
        id: { in: datos.items.map((i) => i.varianteId) },
        deletedAt: null,
        producto: { deletedAt: null },
      },
      select: { id: true, productoId: true },
    }),
  ]);
  if (!deposito) throw new NotFoundError("El galpón no existe");
  if (!deposito.activo) throw new DomainError(`El galpón "${deposito.nombre}" está inactivo`);
  if (!proveedor) throw new NotFoundError("El proveedor no existe o fue dado de baja");
  if (!proveedor.activo) throw new DomainError(`El proveedor "${proveedor.nombre}" está inactivo`);
  if (variantes.length !== datos.items.length)
    throw new NotFoundError("Alguno de los productos no existe o fue dado de baja");
  return new Map(variantes.map((v) => [v.id, v.productoId]));
}

function snapshot(datos: Compra, t: TotalesCompra): Prisma.InputJsonObject {
  return {
    proveedorId: datos.proveedorId,
    depositoId: datos.depositoId,
    total: dec(t.total),
    items: t.items.map((i) => ({
      varianteId: i.varianteId,
      cantidad: i.cantidad,
      costoUnitario: dec(i.costoUnitario),
    })),
  };
}

/**
 * createdAt escalonado (1 ms por ítem): conserva el orden de carga, que
 * define qué costo gana como precio del proveedor (el del último ítem).
 */
function itemsParaCrear(t: TotalesCompra, productoDe: Map<string, string>, costos: CostosFinales) {
  const base = Date.now();
  return t.items.map((i, n) => ({
    ...i,
    productoId: productoDe.get(i.varianteId)!,
    costoUnitarioFinal: decimal(costos.items[n]!.costoUnitarioFinal),
    createdAt: new Date(base + n),
  }));
}

const decimal = (n: number) => new Prisma.Decimal(n.toFixed(2));

/** Costos finales de los ítems ya calculados (`t`), con el % y los gastos vigentes. */
function costosDe(
  t: TotalesCompra,
  comisionPorcentaje: number | Prisma.Decimal | null,
  gastos: Prisma.Decimal[],
): CostosFinales {
  return calcularCostosFinales({
    items: t.items.map((i) => ({
      cantidad: i.cantidad,
      costoUnitario: i.costoUnitario.toFixed(2),
    })),
    comisionPorcentaje: comisionPorcentaje === null ? null : Number(comisionPorcentaje),
    gastos: gastos.map((g) => g.toFixed(2)),
  });
}

/** Columnas de costo final de la compra (todas calculadas acá). */
function columnasCostos(c: CostosFinales) {
  return {
    comisionPasistaPorcentaje: c.comisionPorcentaje === null ? null : decimal(c.comisionPorcentaje),
    comisionPasistaMonto: decimal(c.comision),
    gastosExtrasTotal: decimal(c.gastos),
    costoFinalTotal: decimal(c.costoFinalTotal),
    unidadesTotal: c.unidades,
    costoUnitarioFinalPromedio: decimal(c.costoUnitarioFinalPromedio),
  };
}

/** Pesos por USDT con 2 decimales, o null sin cotización. */
async function cotizacionUsdtActual(): Promise<Prisma.Decimal | null> {
  const c = await obtenerCotizacion("USDT");
  return c ? new Prisma.Decimal(c.valor).toDecimalPlaces(2) : null;
}

/**
 * Snapshot USDT de la compra: `tipoCambio` (el que ya tenía el borrador o el
 * vigente) y el costo en USDT de cada ítem cuyo producto el proveedor cotiza
 * en USDT. Sin productos en USDT no guarda cotización.
 */
async function snapshotUsdt(
  tx: Tx,
  proveedorId: string,
  items: { varianteId: string; costoUnitario: Prisma.Decimal }[],
  productoDe: Map<string, string>,
  tipoCambioPrevio: Prisma.Decimal | null,
): Promise<{ tipoCambio: Prisma.Decimal | null; usdtDe: Map<string, Prisma.Decimal> }> {
  const enUsdt = await tx.proveedorProducto.findMany({
    where: {
      proveedorId,
      moneda: Moneda.USDT,
      productoId: { in: [...new Set(productoDe.values())] },
    },
    select: { productoId: true },
  });
  const usdtDe = new Map<string, Prisma.Decimal>();
  if (enUsdt.length === 0) return { tipoCambio: null, usdtDe };
  const tipoCambio = tipoCambioPrevio ?? (await cotizacionUsdtActual());
  if (!tipoCambio) return { tipoCambio: null, usdtDe };
  const productos = new Set(enUsdt.map((p) => p.productoId));
  for (const i of items)
    if (productos.has(productoDe.get(i.varianteId)!))
      usdtDe.set(i.varianteId, i.costoUnitario.div(tipoCambio).toDecimalPlaces(2));
  return { tipoCambio, usdtDe };
}

function conUsdt(items: ReturnType<typeof itemsParaCrear>, usdtDe: Map<string, Prisma.Decimal>) {
  return items.map((i) => ({ ...i, costoUnitarioUSDT: usdtDe.get(i.varianteId) ?? null }));
}

// =============================================================================
// Escritura
// =============================================================================

/** Crea la compra en BORRADOR (no mueve stock). */
export async function crearCompra(
  ctx: Ctx,
  datos: Compra,
): Promise<{ id: string; numero: number }> {
  return transaccion(ctx, async (tx) => {
    const productoDe = await validarReferencias(tx, datos);
    const t = calcularTotalesCompra(datos);
    const usdt = await snapshotUsdt(tx, datos.proveedorId, t.items, productoDe, null);
    const costos = costosDe(t, datos.comisionPasistaPorcentaje, []);
    const numero = await siguienteNumero(tx, ctx.panelId, "COMPRA");
    const compra = await tx.compra.create({
      data: {
        numero,
        proveedorId: datos.proveedorId,
        depositoId: datos.depositoId,
        fecha: datos.fecha ?? new Date(),
        estado: EstadoCompra.BORRADOR,
        subtotal: t.subtotal,
        descuento: 0,
        total: t.total,
        notas: datos.notas ?? null,
        tipoCambioUSDT: usdt.tipoCambio,
        ...columnasCostos(costos),
        usuarioId: ctx.usuarioId,
        items: { create: conUsdt(itemsParaCrear(t, productoDe, costos), usdt.usdtDe) },
      },
    });
    await sincronizarComisionPasista(tx, ctx, compra.id);
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "Compra",
      entidadId: compra.id,
      datosDespues: {
        numero: compra.numero,
        ...snapshot(datos, t),
        comisionPasistaPorcentaje: datos.comisionPasistaPorcentaje,
      },
      meta: ctx.meta,
    });
    return { id: compra.id, numero: compra.numero };
  });
}

/** Reemplaza los datos e ítems de una compra en BORRADOR. */
export async function actualizarCompra(
  ctx: Ctx,
  id: string,
  datos: Compra,
): Promise<{ id: string; numero: number }> {
  return transaccion(ctx, async (tx) => {
    await bloquearCompra(tx, ctx, id);
    const antes = await tx.compra.findUnique({
      where: { id },
      include: { items: true, gastos: { where: { anulado: false }, select: { monto: true } } },
    });
    if (!antes) throw new NotFoundError("La compra no existe");
    if (antes.estado !== EstadoCompra.BORRADOR) {
      const idVisible = formatearIdCompra(await slugDelPanel(tx, ctx.panelId), antes.numero);
      throw new DomainError(
        `La compra ${idVisible} está ${antes.estado.toLowerCase()}: solo se editan los borradores.`,
      );
    }
    const productoDe = await validarReferencias(tx, datos);
    const t = calcularTotalesCompra(datos);
    // Mismo proveedor → conserva la cotización del borrador (coherente con los costos sugeridos).
    const usdt = await snapshotUsdt(
      tx,
      datos.proveedorId,
      t.items,
      productoDe,
      antes.proveedorId === datos.proveedorId ? antes.tipoCambioUSDT : null,
    );
    const costos = costosDe(
      t,
      datos.comisionPasistaPorcentaje,
      antes.gastos.map((g) => g.monto),
    );
    await tx.compraItem.deleteMany({ where: { compraId: id } });
    await tx.compra.update({
      where: { id },
      data: {
        proveedorId: datos.proveedorId,
        depositoId: datos.depositoId,
        // Mismo día que ya tenía → conserva la hora original.
        fecha: datos.fecha && hoyAR(datos.fecha) !== hoyAR(antes.fecha) ? datos.fecha : antes.fecha,
        subtotal: t.subtotal,
        descuento: 0,
        total: t.total,
        notas: datos.notas ?? null,
        tipoCambioUSDT: usdt.tipoCambio,
        ...columnasCostos(costos),
        items: { create: conUsdt(itemsParaCrear(t, productoDe, costos), usdt.usdtDe) },
      },
    });
    await sincronizarComisionPasista(tx, ctx, id);
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Compra",
      entidadId: id,
      datosAntes: {
        total: dec(antes.total),
        comisionPasistaPorcentaje: antes.comisionPasistaPorcentaje
          ? dec(antes.comisionPasistaPorcentaje)
          : null,
        items: antes.items.map((i) => ({
          varianteId: i.varianteId,
          cantidad: i.cantidad,
          costoUnitario: dec(i.costoUnitario),
        })),
      },
      datosDespues: {
        ...snapshot(datos, t),
        comisionPasistaPorcentaje: datos.comisionPasistaPorcentaje,
      },
      meta: ctx.meta,
    });
    return { id, numero: antes.numero };
  });
}

export type FuenteCostoSugerido = "PROVEEDOR" | "PROVEEDOR_USDT" | "ULTIMO_COSTO";

export interface CostoSugerido {
  /** En pesos. */
  costo: string | null;
  fuente: FuenteCostoSugerido | null;
  /** Solo PROVEEDOR_USDT: precio del proveedor en USDT y la cotización usada. */
  precioUsdt?: string;
  tipoCambio?: string;
}

/**
 * Costo sugerido (en pesos) por sabor para una compra a `proveedorId`: el
 * precio que ese proveedor tiene cargado para el producto (si es en USDT,
 * × la cotización USDT: la del borrador `compraId` si ya tiene, si no la
 * vigente, redondeado a pesos enteros); si no tiene precio (o no hay
 * cotización), el último costo del sabor; si tampoco, null.
 */
export async function costoSugerido(
  ctx: Ctx,
  proveedorId: string,
  varianteIds: string[],
  compraId?: string,
): Promise<Record<string, CostoSugerido>> {
  if (varianteIds.length === 0) return {};
  const db = dbPara(ctx.panelId);
  const variantes = await db.variante.findMany({
    where: { id: { in: varianteIds }, deletedAt: null },
    select: { id: true, productoId: true, ultimoCosto: true },
  });
  const [precios, borrador] = await Promise.all([
    db.proveedorProducto.findMany({
      where: {
        proveedorId,
        productoId: { in: [...new Set(variantes.map((v) => v.productoId))] },
      },
      select: { productoId: true, precio: true, moneda: true },
    }),
    compraId
      ? db.compra.findFirst({
          where: { id: compraId, proveedorId },
          select: { tipoCambioUSDT: true },
        })
      : null,
  ]);
  const precioDe = new Map(precios.map((p) => [p.productoId, p]));
  const tipoCambio = precios.some((p) => p.moneda === Moneda.USDT)
    ? (borrador?.tipoCambioUSDT ?? (await cotizacionUsdtActual()))
    : null;
  return Object.fromEntries(
    variantes.map((v): [string, CostoSugerido] => {
      const precio = precioDe.get(v.productoId);
      if (precio?.moneda === Moneda.ARS)
        return [v.id, { costo: dec(precio.precio), fuente: "PROVEEDOR" }];
      if (precio?.moneda === Moneda.USDT && tipoCambio)
        return [
          v.id,
          {
            costo: dec(precio.precio.mul(tipoCambio).toDecimalPlaces(0)),
            fuente: "PROVEEDOR_USDT",
            precioUsdt: dec(precio.precio),
            tipoCambio: dec(tipoCambio),
          },
        ];
      if (v.ultimoCosto) return [v.id, { costo: dec(v.ultimoCosto), fuente: "ULTIMO_COSTO" }];
      return [v.id, { costo: null, fuente: null }];
    }),
  );
}

export interface CambioPrecioProveedor {
  productoId: string;
  nombreCompleto: string;
  /** null = el proveedor todavía no tenía precio para ese producto. */
  antes: string | null;
  monedaAntes: Moneda | null;
  despues: string;
  monedaDespues: Moneda;
}

interface ItemCosto {
  productoId: string;
  costoUnitario: Prisma.Decimal;
  costoUnitarioUSDT: Prisma.Decimal | null;
  createdAt: Date;
  id: string;
}

/**
 * Ítem por producto cuyo costo quedaría como precio del proveedor: el
 * ÚLTIMO ítem de cada producto (orden de carga).
 */
function ultimoItemPorProducto(items: ItemCosto[]): Map<string, ItemCosto> {
  const orden = [...items].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  return new Map(orden.map((i) => [i.productoId, i]));
}

async function calcularCambiosDePrecio(tx: Tx, compraId: string): Promise<CambioPrecioProveedor[]> {
  const compra = await tx.compra.findUnique({
    where: { id: compraId },
    select: {
      proveedorId: true,
      items: {
        select: {
          id: true,
          productoId: true,
          costoUnitario: true,
          costoUnitarioUSDT: true,
          createdAt: true,
          producto: { select: { nombreCompleto: true } },
        },
      },
    },
  });
  if (!compra) throw new NotFoundError("La compra no existe");
  if (!compra.proveedorId) return [];
  const porProducto = ultimoItemPorProducto(compra.items);
  const actuales = await tx.proveedorProducto.findMany({
    where: { proveedorId: compra.proveedorId, productoId: { in: [...porProducto.keys()] } },
    select: { productoId: true, precio: true, moneda: true },
  });
  const actualDe = new Map(actuales.map((a) => [a.productoId, a]));
  const nombreDe = new Map(compra.items.map((i) => [i.productoId, i.producto.nombreCompleto]));
  return [...porProducto.entries()]
    .flatMap(([productoId, item]) => {
      const actual = actualDe.get(productoId);
      // Si el proveedor cotiza en USDT y la compra tiene el costo en USDT, el
      // precio se actualiza en USDT; si no, en pesos.
      const enUsdt = actual?.moneda === Moneda.USDT && item.costoUnitarioUSDT !== null;
      const costo = enUsdt ? item.costoUnitarioUSDT! : item.costoUnitario;
      const moneda = enUsdt ? Moneda.USDT : Moneda.ARS;
      if (actual && actual.moneda === moneda && actual.precio.equals(costo)) return [];
      return [
        {
          productoId,
          nombreCompleto: nombreDe.get(productoId) ?? "",
          antes: actual ? dec(actual.precio) : null,
          monedaAntes: actual?.moneda ?? null,
          despues: dec(costo),
          monedaDespues: moneda,
        },
      ];
    })
    .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));
}

/** Para el Dialog de "Recibir": productos cuyo precio del proveedor cambiaría (de $X a $Y). */
export async function preciosQueCambian(
  ctx: Ctx,
  compraId: string,
): Promise<CambioPrecioProveedor[]> {
  return calcularCambiosDePrecio(dbPara(ctx.panelId), compraId);
}

/**
 * Recibe la mercadería: un INGRESO_COMPRA por ítem (con su costo y la
 * referencia a la compra) en el galpón de la compra, y `ultimoCosto` de cada
 * sabor = costo de esta compra. Con `actualizarPrecioProveedor`, el precio
 * del proveedor para cada producto pasa a ser el costo pagado (ver arriba:
 * último ítem de cada producto). Transacción Serializable; si ya está
 * recibida → DomainError (no duplica stock).
 */
export async function recibirCompra(
  ctx: Ctx,
  id: string,
  opciones: { actualizarPrecioProveedor: boolean },
): Promise<{ numero: number; unidades: number; preciosActualizados: number }> {
  return transaccion(
    ctx,
    async (tx) => {
      await bloquearCompra(tx, ctx, id);
      const compra = await tx.compra.findUnique({
        where: { id },
        include: { items: true, deposito: true },
      });
      if (!compra) throw new NotFoundError("La compra no existe");
      const idVisible = formatearIdCompra(await slugDelPanel(tx, ctx.panelId), compra.numero);
      if (compra.estado === EstadoCompra.RECIBIDA)
        throw new DomainError(`La compra ${idVisible} ya fue recibida.`);
      if (compra.estado === EstadoCompra.ANULADA)
        throw new DomainError(`La compra ${idVisible} está anulada.`);
      if (!compra.depositoId)
        throw new DomainError("Elegí el galpón donde entra la mercadería antes de recibirla.");
      if (!compra.deposito.activo)
        throw new DomainError(`El galpón "${compra.deposito.nombre}" está inactivo`);
      if (compra.items.length === 0) throw new DomainError("La compra no tiene productos.");

      const cambios =
        opciones.actualizarPrecioProveedor && compra.proveedorId
          ? await calcularCambiosDePrecio(tx, id)
          : [];

      // Orden fijo por variante: mismo orden de bloqueo que el resto del sistema.
      for (const item of [...compra.items].sort((a, b) =>
        a.varianteId.localeCompare(b.varianteId),
      )) {
        await registrarMovimiento(tx, {
          tipo: TipoMovimiento.INGRESO_COMPRA,
          varianteId: item.varianteId,
          depositoId: compra.depositoId,
          cantidad: item.cantidad,
          costoUnitario: item.costoUnitario,
          motivo: `Compra ${idVisible}`,
          referenciaTipo: "COMPRA",
          referenciaId: compra.id,
          usuarioId: ctx.usuarioId,
        });
      }
      // Costo final (con comisión y gastos prorrateados): el de las próximas ventas.
      const anteriores = await tx.variante.findMany({
        where: { id: { in: compra.items.map((i) => i.varianteId) } },
        select: { id: true, ultimoCosto: true },
      });
      const anteriorDe = new Map(anteriores.map((v) => [v.id, v.ultimoCosto]));
      for (const item of [...compra.items].sort((a, b) =>
        a.varianteId.localeCompare(b.varianteId),
      )) {
        await actualizarUltimoCosto(tx, {
          varianteId: item.varianteId,
          anterior: anteriorDe.get(item.varianteId) ?? null,
          nuevo: item.costoUnitarioFinal,
          origen: OrigenCostoVariante.COMPRA_RECIBIDA,
          compraId: compra.id,
          usuarioId: ctx.usuarioId,
        });
      }

      if (compra.proveedorId) {
        for (const c of cambios) {
          await asignarProducto(
            ctx,
            compra.proveedorId,
            { productoId: c.productoId, precio: Number(c.despues), moneda: c.monedaDespues },
            tx,
          );
        }
      }

      await tx.compra.update({ where: { id }, data: { estado: EstadoCompra.RECIBIDA } });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Compra",
        entidadId: id,
        datosAntes: { estado: "BORRADOR" },
        datosDespues: {
          estado: "RECIBIDA",
          actualizarPrecioProveedor: opciones.actualizarPrecioProveedor,
          preciosActualizados: cambios.length,
        },
        meta: ctx.meta,
      });
      return {
        numero: compra.numero,
        unidades: compra.items.reduce((a, i) => a + i.cantidad, 0),
        preciosActualizados: cambios.length,
      };
    },
    { timeout: 60_000, maxRetries: 2 },
  );
}

/**
 * Anula la compra. Si estaba RECIBIDA, devuelve la mercadería al proveedor
 * (DEVOLUCION_PROVEEDOR por ítem): si ya no hay stock suficiente en el
 * galpón, falla completa con el detalle y la compra queda como estaba.
 * No revierte `ultimoCosto` ni precios de proveedor.
 */
export async function anularCompra(
  ctx: Ctx,
  id: string,
  motivo: string,
): Promise<{ numero: number; devoluciones: number }> {
  return transaccion(
    ctx,
    async (tx) => {
      await bloquearCompra(tx, ctx, id);
      const compra = await tx.compra.findUnique({
        where: { id },
        include: {
          deposito: { select: { nombre: true } },
          items: {
            include: {
              variante: {
                select: { nombre: true, producto: { select: { nombreCompleto: true } } },
              },
            },
          },
        },
      });
      if (!compra) throw new NotFoundError("La compra no existe");
      const idVisible = formatearIdCompra(await slugDelPanel(tx, ctx.panelId), compra.numero);
      if (compra.estado === EstadoCompra.ANULADA)
        throw new DomainError(`La compra ${idVisible} ya está anulada.`);

      let devoluciones = 0;
      if (compra.estado === EstadoCompra.RECIBIDA) {
        // Chequeo previo para informar todos los faltantes juntos.
        const stocks = await tx.stock.findMany({
          where: {
            depositoId: compra.depositoId,
            varianteId: { in: compra.items.map((i) => i.varianteId) },
          },
          select: { varianteId: true, cantidad: true },
        });
        const disp = new Map(stocks.map((s) => [s.varianteId, s.cantidad]));
        const faltan = compra.items
          .filter((i) => (disp.get(i.varianteId) ?? 0) < i.cantidad)
          .map(
            (i) =>
              `${nombreItem(i.variante)}: hay ${disp.get(i.varianteId) ?? 0}, se devuelven ${i.cantidad}`,
          );
        if (faltan.length) {
          throw new DomainError(
            `No se puede anular la compra ${idVisible}: ya no está todo el stock en ${compra.deposito.nombre}. ${faltan.join(" · ")}`,
            "STOCK_INSUFICIENTE",
            409,
          );
        }
        try {
          for (const item of [...compra.items].sort((a, b) =>
            a.varianteId.localeCompare(b.varianteId),
          )) {
            await registrarMovimiento(tx, {
              tipo: TipoMovimiento.DEVOLUCION_PROVEEDOR,
              varianteId: item.varianteId,
              depositoId: compra.depositoId,
              cantidad: item.cantidad,
              costoUnitario: item.costoUnitario,
              motivo: `Anulación compra ${idVisible}: ${motivo}`,
              referenciaTipo: "COMPRA",
              referenciaId: compra.id,
              usuarioId: ctx.usuarioId,
            });
            devoluciones++;
          }
        } catch (e) {
          if (e instanceof StockInsuficienteError) {
            throw new DomainError(
              `No se puede anular la compra ${idVisible}: ${e.message}`,
              "STOCK_INSUFICIENTE",
              409,
            );
          }
          throw e;
        }
      }

      const notas = [compra.notas, `[Anulada] ${motivo}`].filter(Boolean).join("\n");
      await tx.compra.update({ where: { id }, data: { estado: EstadoCompra.ANULADA, notas } });
      // Comisión del pasista: pendiente se borra; ya pagada queda un ajuste negativo.
      await sincronizarComisionPasista(tx, ctx, id);
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Compra",
        entidadId: id,
        datosAntes: { estado: compra.estado },
        datosDespues: { estado: "ANULADA", motivo, devoluciones },
        meta: ctx.meta,
      });
      return { numero: compra.numero, devoluciones };
    },
    { timeout: 60_000, maxRetries: 2 },
  );
}

// =============================================================================
// Costos finales: comisión del pasista y gastos extras
// =============================================================================

/**
 * Recalcula y guarda los costos finales de la compra (columnas de Compra y
 * CompraItem.costoUnitarioFinal) con su comisión y sus gastos vigentes. Si
 * está RECIBIDA, el costo final pasa a `ultimoCosto` de los sabores cuya
 * última compra recibida es esta (si después entró otra compra de ese sabor,
 * manda la otra). Las ventas ya hechas conservan su snapshot de costo.
 * Se llama dentro de la transacción del cambio, con la compra bloqueada.
 */
export async function recalcularCostosFinales(
  tx: Tx,
  ctx: Ctx,
  compraId: string,
  /** Nuevo % del pasista (null = sin comisión); sin pasar, el que ya tiene. */
  opciones: { comisionPorcentaje?: number | null } = {},
): Promise<CostosFinales> {
  const compra = await tx.compra.findUnique({
    where: { id: compraId },
    select: {
      id: true,
      estado: true,
      descuento: true,
      comisionPasistaPorcentaje: true,
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          varianteId: true,
          cantidad: true,
          costoUnitario: true,
          costoUnitarioFinal: true,
        },
      },
      gastos: { where: { anulado: false }, select: { monto: true } },
    },
  });
  if (!compra) throw new NotFoundError("La compra no existe");
  const costos = calcularCostosFinales({
    items: compra.items.map((i) => ({
      cantidad: i.cantidad,
      costoUnitario: i.costoUnitario.toFixed(2),
    })),
    descuento: compra.descuento.toFixed(2),
    comisionPorcentaje:
      opciones.comisionPorcentaje !== undefined
        ? opciones.comisionPorcentaje
        : (compra.comisionPasistaPorcentaje?.toFixed(2) ?? null),
    gastos: compra.gastos.map((g) => g.monto.toFixed(2)),
  });
  await tx.compra.update({ where: { id: compraId }, data: columnasCostos(costos) });
  const finalDe = new Map<string, Prisma.Decimal>();
  for (const [n, item] of compra.items.entries()) {
    const final = decimal(costos.items[n]!.costoUnitarioFinal);
    finalDe.set(item.varianteId, final);
    if (!item.costoUnitarioFinal.equals(final))
      await tx.compraItem.update({ where: { id: item.id }, data: { costoUnitarioFinal: final } });
  }

  if (compra.estado === EstadoCompra.RECIBIDA && compra.items.length > 0) {
    const ultimas = await tx.$queryRaw<{ varianteId: string; compraId: string }[]>`
      SELECT DISTINCT ON (m."varianteId") m."varianteId" AS "varianteId", m."referenciaId" AS "compraId"
      FROM "MovimientoStock" m
      JOIN "Compra" c ON c."id" = m."referenciaId" AND c."estado" = 'RECIBIDA'
      WHERE m."panelId" = ${ctx.panelId} AND c."panelId" = ${ctx.panelId}
        AND m."tipo" = 'INGRESO_COMPRA' AND m."referenciaTipo" = 'COMPRA'
        AND m."varianteId" IN (${Prisma.join([...finalDe.keys()])})
      ORDER BY m."varianteId", m."createdAt" DESC, m."id" DESC`;
    const propias = ultimas.filter((u) => u.compraId === compraId).map((u) => u.varianteId);
    if (propias.length > 0) {
      const variantes = await tx.variante.findMany({
        where: { id: { in: propias } },
        select: { id: true, ultimoCosto: true },
        orderBy: { id: "asc" },
      });
      for (const v of variantes) {
        await actualizarUltimoCosto(tx, {
          varianteId: v.id,
          anterior: v.ultimoCosto,
          nuevo: finalDe.get(v.id)!,
          origen: OrigenCostoVariante.COSTOS_FINALES_COMPRA,
          compraId,
          usuarioId: ctx.usuarioId,
        });
      }
    }
  }
  await sincronizarComisionPasista(tx, ctx, compraId);
  return costos;
}

async function compraParaCostos(tx: Tx, ctx: Ctx, id: string) {
  await bloquearCompra(tx, ctx, id);
  const compra = await tx.compra.findUnique({
    where: { id },
    select: {
      id: true,
      numero: true,
      estado: true,
      comisionPasistaPorcentaje: true,
      comisionPasistaMonto: true,
      gastosExtrasTotal: true,
      costoFinalTotal: true,
    },
  });
  if (!compra) throw new NotFoundError("La compra no existe");
  const idVisible = formatearIdCompra(await slugDelPanel(tx, ctx.panelId), compra.numero);
  if (compra.estado === EstadoCompra.ANULADA)
    throw new DomainError(`La compra ${idVisible} está anulada: sus costos no cambian.`);
  return { ...compra, idVisible };
}

const resumenCostos = (c: {
  comisionPasistaPorcentaje: Prisma.Decimal | null;
  comisionPasistaMonto: Prisma.Decimal;
  gastosExtrasTotal: Prisma.Decimal;
  costoFinalTotal: Prisma.Decimal;
}) => ({
  comisionPasistaPorcentaje: c.comisionPasistaPorcentaje ? dec(c.comisionPasistaPorcentaje) : null,
  comisionPasistaMonto: dec(c.comisionPasistaMonto),
  gastosExtrasTotal: dec(c.gastosExtrasTotal),
  costoFinalTotal: dec(c.costoFinalTotal),
});

/** Tilda/destilda (o cambia el %) de la comisión del pasista de una compra borrador o recibida. */
export async function cambiarComisionPasista(
  ctx: Ctx,
  compraId: string,
  porcentaje: number | null,
): Promise<{ idVisible: string; costos: CostosFinales }> {
  return transaccion(ctx, async (tx) => {
    const antes = await compraParaCostos(tx, ctx, compraId);
    const costos = await recalcularCostosFinales(tx, ctx, compraId, {
      comisionPorcentaje: porcentaje,
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Compra",
      entidadId: compraId,
      datosAntes: resumenCostos(antes),
      datosDespues: {
        comisionPasistaPorcentaje: porcentaje === null ? null : porcentaje.toFixed(2),
        comisionPasistaMonto: costos.comision.toFixed(2),
        costoFinalTotal: costos.costoFinalTotal.toFixed(2),
      },
      meta: ctx.meta,
    });
    return { idVisible: antes.idVisible, costos };
  });
}

/** Suma gastos extras (valija, envío…) a una compra borrador o recibida y recalcula. */
export async function agregarGastosCompra(
  ctx: Ctx,
  compraId: string,
  gastos: { motivo: string; monto: number }[],
): Promise<{ idVisible: string; costos: CostosFinales }> {
  if (gastos.length === 0) throw new DomainError("Cargá al menos un gasto");
  return transaccion(ctx, async (tx) => {
    const antes = await compraParaCostos(tx, ctx, compraId);
    const ahora = new Date();
    for (const g of gastos) {
      await tx.gastoCompra.create({
        data: {
          compraId,
          motivo: g.motivo.trim(),
          monto: decimal(g.monto),
          fecha: ahora,
          usuarioId: ctx.usuarioId,
        },
      });
    }
    const costos = await recalcularCostosFinales(tx, ctx, compraId);
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "GastoCompra",
      entidadId: compraId,
      datosAntes: resumenCostos(antes),
      datosDespues: {
        gastos: gastos.map((g) => ({ motivo: g.motivo, monto: g.monto.toFixed(2) })),
        gastosExtrasTotal: costos.gastos.toFixed(2),
        costoFinalTotal: costos.costoFinalTotal.toFixed(2),
      },
      meta: ctx.meta,
    });
    return { idVisible: antes.idVisible, costos };
  });
}

/** Anula un gasto extra (solo dueños: lo exige la acción) y recalcula la compra. */
export async function anularGastoCompra(
  ctx: Ctx,
  gastoId: string,
  motivo: string,
): Promise<{ idVisible: string; costos: CostosFinales }> {
  return transaccion(ctx, async (tx) => {
    const gasto = await tx.gastoCompra.findUnique({
      where: { id: gastoId },
      select: { id: true, compraId: true, anulado: true, motivo: true, monto: true },
    });
    if (!gasto) throw new NotFoundError("El gasto no existe");
    const antes = await compraParaCostos(tx, ctx, gasto.compraId);
    if (gasto.anulado) throw new DomainError("El gasto ya está anulado");
    await tx.gastoCompra.update({
      where: { id: gastoId },
      data: {
        anulado: true,
        anuladoPorId: ctx.usuarioId,
        anuladoAt: new Date(),
        motivoAnulacion: motivo,
      },
    });
    const costos = await recalcularCostosFinales(tx, ctx, gasto.compraId);
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "GastoCompra",
      entidadId: gastoId,
      datosAntes: {
        anulado: false,
        motivo: gasto.motivo,
        monto: dec(gasto.monto),
        ...resumenCostos(antes),
      },
      datosDespues: {
        anulado: true,
        motivoAnulacion: motivo,
        costoFinalTotal: costos.costoFinalTotal.toFixed(2),
      },
      meta: ctx.meta,
    });
    return { idVisible: antes.idVisible, costos };
  });
}

export interface GastoCompraDetalle {
  id: string;
  motivo: string;
  monto: string;
  fecha: Date;
  usuario: string;
  anulado: boolean;
  motivoAnulacion: string | null;
}

/** Lo que necesita el Sheet de gastos: los gastos y los números para el recálculo en vivo. */
export interface CostosCompra {
  compraId: string;
  estado: EstadoCompra;
  /** subtotal − descuento. */
  total: string;
  descuento: string;
  comisionPasistaPorcentaje: string | null;
  comisionPasistaMonto: string;
  gastosExtrasTotal: string;
  costoFinalTotal: string;
  unidades: number;
  costoUnitarioFinalPromedio: string;
  /** Para recalcular en vivo con calcularCostosFinales. */
  items: { cantidad: number; costoUnitario: string }[];
  gastos: GastoCompraDetalle[];
}

export async function obtenerCostosCompra(ctx: Ctx, compraId: string): Promise<CostosCompra> {
  const c = await dbPara(ctx.panelId).compra.findUnique({
    where: { id: compraId },
    include: {
      items: {
        select: { cantidad: true, costoUnitario: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
      gastos: {
        orderBy: [{ fecha: "asc" }, { id: "asc" }],
        include: { usuario: { select: { nombre: true } } },
      },
    },
  });
  if (!c) throw new NotFoundError("La compra no existe");
  return {
    compraId: c.id,
    estado: c.estado,
    total: dec(c.total),
    descuento: dec(c.descuento),
    comisionPasistaPorcentaje: c.comisionPasistaPorcentaje
      ? dec(c.comisionPasistaPorcentaje)
      : null,
    comisionPasistaMonto: dec(c.comisionPasistaMonto),
    gastosExtrasTotal: dec(c.gastosExtrasTotal),
    costoFinalTotal: dec(c.costoFinalTotal),
    unidades: c.unidadesTotal,
    costoUnitarioFinalPromedio: dec(c.costoUnitarioFinalPromedio),
    items: c.items.map((i) => ({ cantidad: i.cantidad, costoUnitario: dec(i.costoUnitario) })),
    gastos: c.gastos.map((g) => ({
      id: g.id,
      motivo: g.motivo,
      monto: dec(g.monto),
      fecha: g.fecha,
      usuario: g.usuario.nombre,
      anulado: g.anulado,
      motivoAnulacion: g.motivoAnulacion,
    })),
  };
}

/** "Elf Bar BC 5000 — Mango Ice"; el sabor "Único" no se muestra. */
function nombreItem(v: { nombre: string; producto: { nombreCompleto: string } }): string {
  return esSaborUnico(v.nombre)
    ? v.producto.nombreCompleto
    : `${v.producto.nombreCompleto} — ${v.nombre}`;
}

const esSaborUnico = (nombre: string) => nombre.trim().toLowerCase() === "único";

// =============================================================================
// Lectura
// =============================================================================

export interface CompraListada {
  id: string;
  numero: number;
  fecha: Date;
  estado: EstadoCompra;
  proveedor: string | null;
  proveedorId: string | null;
  deposito: string;
  items: number;
  unidades: number;
  total: string;
  usuario: string;
  /** Costos finales (las columnas solo las ven los dueños). */
  comisionPasistaPorcentaje: string | null;
  comisionPasistaMonto: string;
  gastosExtrasTotal: string;
  costoFinalTotal: string;
  costoUnitarioFinalPromedio: string;
}

export async function listarCompras(
  ctx: Ctx,
  f: FiltrosCompras,
): Promise<{ compras: CompraListada[]; total: number; page: number; pageSize: number }> {
  const where: Prisma.CompraWhereInput = {};
  if (f.estado) where.estado = f.estado;
  if (f.proveedorId) where.proveedorId = f.proveedorId;
  if (f.desde || f.hasta) {
    where.fecha = {
      ...(f.desde ? { gte: inicioDelDia(f.desde) } : {}),
      ...(f.hasta ? { lte: finDelDia(f.hasta) } : {}),
    };
  }
  const db = dbPara(ctx.panelId);
  const [total, filas] = await Promise.all([
    db.compra.count({ where }),
    db.compra.findMany({
      where,
      orderBy: { numero: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        proveedor: { select: { nombre: true, nombreTienda: true } },
        deposito: { select: { nombre: true } },
        usuario: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
  ]);
  return {
    compras: filas.map((c) => ({
      id: c.id,
      numero: c.numero,
      fecha: c.fecha,
      estado: c.estado,
      proveedor: c.proveedor ? `${c.proveedor.nombre} (${c.proveedor.nombreTienda})` : null,
      proveedorId: c.proveedorId,
      deposito: c.deposito.nombre,
      items: c.items.length,
      unidades: c.items.reduce((a, i) => a + i.cantidad, 0),
      total: dec(c.total),
      usuario: c.usuario.nombre,
      comisionPasistaPorcentaje: c.comisionPasistaPorcentaje
        ? dec(c.comisionPasistaPorcentaje)
        : null,
      comisionPasistaMonto: dec(c.comisionPasistaMonto),
      gastosExtrasTotal: dec(c.gastosExtrasTotal),
      costoFinalTotal: dec(c.costoFinalTotal),
      costoUnitarioFinalPromedio: dec(c.costoUnitarioFinalPromedio),
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export interface ItemCompraDetalle {
  varianteId: string;
  productoId: string;
  nombreCompleto: string;
  /** null = sabor "Único" (no se muestra). */
  sabor: string | null;
  sku: string;
  codigoBarras: string | null;
  cantidad: number;
  costoUnitario: string;
  /** Solo si el proveedor cotiza ese producto en USDT (ver snapshotUsdt). */
  costoUnitarioUSDT: string | null;
  subtotal: string;
  /** Costo con la comisión y los gastos prorrateados por unidad. */
  costoUnitarioFinal: string;
}

export interface CompraDetalle extends Omit<CompraListada, "items"> {
  depositoId: string;
  proveedorNombre: string | null;
  proveedorTienda: string | null;
  subtotal: string;
  notas: string | null;
  /** Pesos por USDT usados al cargar la compra (null = sin precios en USDT). */
  tipoCambioUSDT: string | null;
  descuento: string;
  items: ItemCompraDetalle[];
  gastos: GastoCompraDetalle[];
  movimientos: number;
}

export async function obtenerCompra(ctx: Ctx, id: string): Promise<CompraDetalle> {
  const db = dbPara(ctx.panelId);
  const c = await db.compra.findUnique({
    where: { id },
    include: {
      proveedor: { select: { nombre: true, nombreTienda: true } },
      deposito: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
      gastos: {
        orderBy: [{ fecha: "asc" }, { id: "asc" }],
        include: { usuario: { select: { nombre: true } } },
      },
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          variante: {
            select: {
              nombre: true,
              sku: true,
              codigoBarras: true,
              producto: { select: { nombreCompleto: true } },
            },
          },
        },
      },
    },
  });
  if (!c) throw new NotFoundError("La compra no existe");
  const movimientos = await db.movimientoStock.count({
    where: { referenciaTipo: "COMPRA", referenciaId: id },
  });
  return {
    id: c.id,
    numero: c.numero,
    fecha: c.fecha,
    estado: c.estado,
    proveedor: c.proveedor ? `${c.proveedor.nombre} (${c.proveedor.nombreTienda})` : null,
    proveedorId: c.proveedorId,
    proveedorNombre: c.proveedor?.nombre ?? null,
    proveedorTienda: c.proveedor?.nombreTienda ?? null,
    deposito: c.deposito.nombre,
    depositoId: c.depositoId,
    usuario: c.usuario.nombre,
    unidades: c.items.reduce((a, i) => a + i.cantidad, 0),
    subtotal: dec(c.subtotal),
    descuento: dec(c.descuento),
    total: dec(c.total),
    comisionPasistaPorcentaje: c.comisionPasistaPorcentaje
      ? dec(c.comisionPasistaPorcentaje)
      : null,
    comisionPasistaMonto: dec(c.comisionPasistaMonto),
    gastosExtrasTotal: dec(c.gastosExtrasTotal),
    costoFinalTotal: dec(c.costoFinalTotal),
    costoUnitarioFinalPromedio: dec(c.costoUnitarioFinalPromedio),
    gastos: c.gastos.map((g) => ({
      id: g.id,
      motivo: g.motivo,
      monto: dec(g.monto),
      fecha: g.fecha,
      usuario: g.usuario.nombre,
      anulado: g.anulado,
      motivoAnulacion: g.motivoAnulacion,
    })),
    notas: c.notas,
    tipoCambioUSDT: c.tipoCambioUSDT ? dec(c.tipoCambioUSDT) : null,
    movimientos,
    items: c.items.map((i) => ({
      varianteId: i.varianteId,
      productoId: i.productoId,
      nombreCompleto: i.variante.producto.nombreCompleto,
      sabor: esSaborUnico(i.variante.nombre) ? null : i.variante.nombre,
      sku: i.variante.sku,
      codigoBarras: i.variante.codigoBarras,
      cantidad: i.cantidad,
      costoUnitario: dec(i.costoUnitario),
      costoUnitarioUSDT: i.costoUnitarioUSDT ? dec(i.costoUnitarioUSDT) : null,
      subtotal: dec(i.subtotal),
      costoUnitarioFinal: dec(i.costoUnitarioFinal),
    })),
  };
}
