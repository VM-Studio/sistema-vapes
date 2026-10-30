import {
  AccionAuditoria,
  EstadoCompra,
  Moneda,
  OrigenCostoVariante,
  Prisma,
  TipoMovimiento,
} from "@prisma/client";

import type { CotizacionResumen } from "@/components/compras/resumen-compra-card";
import { fechaHoraCotizacion } from "@/lib/cambio";
import {
  calcularCostosCompraUsdt,
  calcularCostosFinales,
  pesosAMoneda,
  usdtAPesos,
  vistaCostosUsdt,
  type CostosCompraUsdt,
  type CostosFinales,
  type VistaCostosUsdt,
} from "@/lib/costos-compra";
import { finDelDia, hoyAR, inicioDelDia } from "@/lib/fechas";
import { formatearIdCompra } from "@/lib/paneles";
import type { Compra, FiltrosCompras } from "@/lib/validations/compra";
import { saborVisible } from "@/lib/validations/producto";
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
 * - Estados: «Confirmar» crea la compra en BORRADOR, que la UI muestra como
 *   «Pendiente de recibir» (confirmada, todavía sin stock; se puede editar).
 *   «Recibido» (recibirCompra) la pasa a RECIBIDA. Se reusa BORRADOR en vez
 *   de sumar un estado al enum: CHECKs, triggers de ítems editables,
 *   reportes, pasista y proveedores ya lo tratan como "sin stock todavía".
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
 * - MONEDA PRINCIPAL: USDT (desde 2026-10-30, Compra.costosEnUsdt). El costo
 *   de cada ítem (CompraItem.costoUnitarioUSDT) y los gastos extras
 *   (GastoCompra.montoUSDT) se cargan en USDT y el costo final se calcula en
 *   USDT (calcularCostosCompraUsdt). Los pesos (lo que contabilizan stock y
 *   ganancia) se derivan una sola vez con la cotización USDT de la compra
 *   (Compra.tipoCambioUSDT: snapshot al crearla, conservado al editarla).
 *   Sin cotización USDT no se puede guardar. También se guarda el dólar blue
 *   (Compra.tipoCambioUSD) para mostrar el costo final en dólares.
 *   Las compras anteriores (costosEnUsdt = false) siguen calculándose en
 *   pesos; sus USDT se muestran como aproximados.
 * - COSTO FINAL (Bloque 6, A4): a cada ítem se le suma la comisión del
 *   pasista PROPORCIONAL A SU PRECIO (costo × factor de descuento × %) y los
 *   gastos extras (GastoCompra: valija, envío…) PAREJOS POR UNIDAD
 *   (calcularCostosFinales en src/lib/costos-compra.ts, ahí están la fórmula,
 *   el porqué y el reparto del residuo de redondeo) → CompraItem.costoUnitarioFinal.
 *   Las compras recibidas antes de A4 conservan el costo final con el criterio
 *   anterior (recargo parejo): no se recalculan en masa; se pasan al nuevo
 *   criterio solo cuando algo dispara `recalcularCostosFinales` (tick, %, gastos).
 * - Comisión del pasista: se genera al CONFIRMAR (crear) la compra, como
 *   siempre; recibirla no la cambia. `recalcularCostosFinales` corre
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
    /** En pesos = ROUND(costoUnitarioUSDT × cotización, 2). */
    costoUnitario: Prisma.Decimal;
    /** Lo cargado. */
    costoUnitarioUSDT: Prisma.Decimal;
    subtotal: Prisma.Decimal;
  }[];
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

export { calcularCostosFinales };

/**
 * Ítems cargados en USDT → costo en pesos con la cotización de la compra.
 * subtotal ítem = cantidad × costo en pesos · total = Σ ítems (en pesos).
 */
export function calcularTotalesCompra(
  datos: Pick<Compra, "items">,
  tipoCambioUSDT: Prisma.Decimal,
): TotalesCompra {
  const items = datos.items.map((i) => {
    const costoUnitarioUSDT = new Prisma.Decimal(i.costoUnitarioUSDT).toDecimalPlaces(2);
    const costoUnitario = decimal(
      usdtAPesos(costoUnitarioUSDT.toFixed(2), tipoCambioUSDT.toFixed(2)),
    );
    return {
      varianteId: i.varianteId,
      cantidad: i.cantidad,
      costoUnitario,
      costoUnitarioUSDT,
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
      costoUnitarioUSDT: dec(i.costoUnitarioUSDT),
      costoUnitario: dec(i.costoUnitario),
    })),
  };
}

/**
 * createdAt escalonado (1 ms por ítem): conserva el orden de carga, que
 * define qué costo gana como precio del proveedor (el del último ítem).
 */
function itemsParaCrear(
  t: TotalesCompra,
  productoDe: Map<string, string>,
  costos: CostosCompraUsdt,
) {
  const base = Date.now();
  return t.items.map((i, n) => ({
    ...i,
    productoId: productoDe.get(i.varianteId)!,
    costoUnitarioFinal: decimal(costos.itemsPesos[n]!.costoUnitarioFinal),
    createdAt: new Date(base + n),
  }));
}

const decimal = (n: number) => new Prisma.Decimal(n.toFixed(2));

interface GastoVigente {
  monto: Prisma.Decimal;
  montoUSDT: Prisma.Decimal | null;
}

/**
 * Gastos de una compra para el cálculo en USDT: el monto cargado en USDT y el
 * guardado en pesos. Un gasto anterior a las compras en USDT (sin montoUSDT)
 * se toma por su equivalente con la cotización de la compra.
 */
const gastosParaUsdt = (gastos: GastoVigente[], tipoCambio: Prisma.Decimal) =>
  gastos.map((g) => ({
    montoUSDT: g.montoUSDT
      ? g.montoUSDT.toFixed(2)
      : pesosAMoneda(g.monto.toFixed(2), tipoCambio.toFixed(2)),
    monto: g.monto.toFixed(2),
  }));

/** Costos finales (en USDT y pasados a pesos) de los ítems de `t`, con el % y los gastos vigentes. */
function costosDe(
  t: TotalesCompra,
  comisionPorcentaje: number | Prisma.Decimal | null,
  gastos: GastoVigente[],
  tipoCambio: Prisma.Decimal,
): CostosCompraUsdt {
  return calcularCostosCompraUsdt({
    items: t.items.map((i) => ({
      cantidad: i.cantidad,
      costoUnitarioUSDT: i.costoUnitarioUSDT.toFixed(2),
    })),
    comisionPorcentaje: comisionPorcentaje === null ? null : Number(comisionPorcentaje),
    gastos: gastosParaUsdt(gastos, tipoCambio),
    tipoCambioUSDT: tipoCambio.toFixed(2),
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

/**
 * Cotización para los equivalentes en USDT del resumen de una compra: la
 * guardada en la compra (snapshot) si tiene; si no, la vigente (cambio.service).
 * null sin ninguna (la UI lo indica sin romper).
 */
export async function cotizacionResumenCompra(
  tipoCambioUSDT: string | null,
): Promise<CotizacionResumen | null> {
  if (tipoCambioUSDT) return { valor: Number(tipoCambioUSDT), origen: "guardada en la compra" };
  const vigente = await obtenerCotizacion("USDT").catch(() => null);
  return vigente
    ? { valor: vigente.valor, origen: `vigente ${fechaHoraCotizacion(vigente.obtenidoAt)}` }
    : null;
}

/**
 * Dólar blue para mostrar el costo final por unidad en dólares: el guardado
 * en la compra o, si no tiene (compra anterior), el vigente.
 */
export async function cotizacionUsdCompra(
  tipoCambioUSD: string | null,
): Promise<CotizacionResumen | null> {
  if (tipoCambioUSD) return { valor: Number(tipoCambioUSD), origen: "guardada en la compra" };
  const vigente = await obtenerCotizacion("USD_BLUE").catch(() => null);
  return vigente
    ? { valor: vigente.valor, origen: `vigente ${fechaHoraCotizacion(vigente.obtenidoAt)}` }
    : null;
}

/** Datos guardados de una compra que hacen falta para mostrarla en USDT. */
interface CompraParaVista {
  costosEnUsdt: boolean;
  descuento: Prisma.Decimal;
  comisionPasistaPorcentaje: Prisma.Decimal | null;
  items: {
    cantidad: number;
    costoUnitario: Prisma.Decimal;
    costoUnitarioUSDT: Prisma.Decimal | null;
    costoUnitarioFinal: Prisma.Decimal;
  }[];
  gastos: { monto: Prisma.Decimal; montoUSDT: Prisma.Decimal | null; anulado: boolean }[];
}

/** Costos en USDT de una compra guardada (null sin ninguna cotización USDT). */
function vistaDe(c: CompraParaVista, cotizacion: CotizacionResumen | null): VistaCostosUsdt | null {
  if (!cotizacion) return null;
  return vistaCostosUsdt({
    costosEnUsdt: c.costosEnUsdt,
    tipoCambioUSDT: cotizacion.valor.toFixed(2),
    comisionPorcentaje: c.comisionPasistaPorcentaje?.toFixed(2) ?? null,
    descuento: c.descuento.toFixed(2),
    items: c.items.map((i) => ({
      cantidad: i.cantidad,
      costoUnitario: i.costoUnitario.toFixed(2),
      costoUnitarioUSDT: i.costoUnitarioUSDT?.toFixed(2) ?? null,
      costoUnitarioFinal: i.costoUnitarioFinal.toFixed(2),
    })),
    gastos: c.gastos
      .filter((g) => !g.anulado)
      .map((g) => ({ monto: g.monto.toFixed(2), montoUSDT: g.montoUSDT?.toFixed(2) ?? null })),
  });
}

/** Pesos por USDT con 2 decimales, o null sin cotización. */
async function cotizacionUsdtActual(): Promise<Prisma.Decimal | null> {
  const c = await obtenerCotizacion("USDT");
  return c ? new Prisma.Decimal(c.valor).toDecimalPlaces(2) : null;
}

/**
 * Cotizaciones de una compra al guardarla: la USDT (obligatoria: con ella se
 * derivan los pesos) y el dólar blue (opcional, solo para mostrar). Si la
 * compra ya tenía, se conservan; si no, las vigentes.
 */
async function cotizacionesCompra(previas: {
  tipoCambioUSDT: Prisma.Decimal | null;
  tipoCambioUSD: Prisma.Decimal | null;
}): Promise<{ usdt: Prisma.Decimal; usd: Prisma.Decimal | null }> {
  const usdt = previas.tipoCambioUSDT ?? (await cotizacionUsdtActual().catch(() => null));
  if (!usdt)
    throw new DomainError(
      "No hay cotización USDT para pasar la compra a pesos. Cargala a mano en la barra de cotizaciones y volvé a intentar.",
      "SIN_COTIZACION",
      409,
    );
  const usd =
    previas.tipoCambioUSD ??
    (await obtenerCotizacion("USD_BLUE")
      .then((c) => (c ? new Prisma.Decimal(c.valor).toDecimalPlaces(2) : null))
      .catch(() => null));
  return { usdt, usd };
}

// =============================================================================
// Escritura
// =============================================================================

/** «Confirmar»: crea la compra en BORRADOR = pendiente de recibir (no mueve stock). */
export async function crearCompra(
  ctx: Ctx,
  datos: Compra,
): Promise<{ id: string; numero: number }> {
  return transaccion(ctx, async (tx) => {
    const productoDe = await validarReferencias(tx, datos);
    const tc = await cotizacionesCompra({ tipoCambioUSDT: null, tipoCambioUSD: null });
    const t = calcularTotalesCompra(datos, tc.usdt);
    const costos = costosDe(t, datos.comisionPasistaPorcentaje, [], tc.usdt);
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
        costosEnUsdt: true,
        tipoCambioUSDT: tc.usdt,
        tipoCambioUSD: tc.usd,
        ...columnasCostos(costos.pesos),
        usuarioId: ctx.usuarioId,
        items: { create: itemsParaCrear(t, productoDe, costos) },
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
        tipoCambioUSDT: dec(tc.usdt),
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
      include: {
        items: true,
        gastos: { where: { anulado: false }, select: { monto: true, montoUSDT: true } },
      },
    });
    if (!antes) throw new NotFoundError("La compra no existe");
    if (antes.estado !== EstadoCompra.BORRADOR) {
      const idVisible = formatearIdCompra(await slugDelPanel(tx, ctx.panelId), antes.numero);
      throw new DomainError(
        `La compra ${idVisible} está ${antes.estado.toLowerCase()}: solo se editan las pendientes de recibir.`,
      );
    }
    const productoDe = await validarReferencias(tx, datos);
    // Conserva la cotización de la compra: los costos sugeridos y lo que se vio salió de ella.
    const tc = await cotizacionesCompra(antes);
    const t = calcularTotalesCompra(datos, tc.usdt);
    const costos = costosDe(t, datos.comisionPasistaPorcentaje, antes.gastos, tc.usdt);
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
        costosEnUsdt: true,
        tipoCambioUSDT: tc.usdt,
        tipoCambioUSD: tc.usd,
        ...columnasCostos(costos.pesos),
        items: { create: itemsParaCrear(t, productoDe, costos) },
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
        tipoCambioUSDT: antes.tipoCambioUSDT ? dec(antes.tipoCambioUSDT) : null,
        items: antes.items.map((i) => ({
          varianteId: i.varianteId,
          cantidad: i.cantidad,
          costoUnitarioUSDT: i.costoUnitarioUSDT ? dec(i.costoUnitarioUSDT) : null,
          costoUnitario: dec(i.costoUnitario),
        })),
      },
      datosDespues: {
        ...snapshot(datos, t),
        tipoCambioUSDT: dec(tc.usdt),
        comisionPasistaPorcentaje: datos.comisionPasistaPorcentaje,
      },
      meta: ctx.meta,
    });
    return { id, numero: antes.numero };
  });
}

export type FuenteCostoSugerido = "PROVEEDOR" | "PROVEEDOR_USDT" | "ULTIMO_COSTO";

export interface CostoSugerido {
  /** En USDT (moneda de Compras). */
  costo: string | null;
  fuente: FuenteCostoSugerido | null;
  /**
   * Solo si salió de un monto en pesos (precio del proveedor en pesos o
   * último costo): ese monto y la cotización con la que se pasó a USDT.
   */
  pesos?: string;
  tipoCambio?: string;
}

/**
 * Cotización USDT para sugerir costos: la de la compra `compraId` si ya
 * tiene (borrador en edición), si no la vigente.
 */
async function cotizacionParaSugerir(
  ctx: Ctx,
  compraId: string | undefined,
): Promise<Prisma.Decimal | null> {
  const compra = compraId
    ? await dbPara(ctx.panelId).compra.findFirst({
        where: { id: compraId },
        select: { tipoCambioUSDT: true },
      })
    : null;
  return compra?.tipoCambioUSDT ?? (await cotizacionUsdtActual().catch(() => null));
}

/** Monto en pesos → USDT con la cotización (null sin cotización). */
const enUsdt = (pesos: Prisma.Decimal, tipoCambio: Prisma.Decimal | null) =>
  tipoCambio ? pesosAMoneda(pesos.toFixed(2), tipoCambio.toFixed(2)).toFixed(2) : null;

/**
 * Costo sugerido EN USDT por sabor para una compra a `proveedorId`: el precio
 * que ese proveedor tiene cargado para el producto (en USDT tal cual; en
 * pesos, ÷ la cotización USDT de la compra o la vigente); si no tiene
 * precio, el último costo del sabor (en pesos ÷ cotización); si tampoco (o
 * no hay cotización para pasar pesos a USDT), null.
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
  const precios = await db.proveedorProducto.findMany({
    where: {
      proveedorId,
      productoId: { in: [...new Set(variantes.map((v) => v.productoId))] },
    },
    select: { productoId: true, precio: true, moneda: true },
  });
  const precioDe = new Map(precios.map((p) => [p.productoId, p]));
  const necesitaCotizacion = variantes.some(
    (v) => precioDe.get(v.productoId)?.moneda !== Moneda.USDT,
  );
  const tipoCambio = necesitaCotizacion ? await cotizacionParaSugerir(ctx, compraId) : null;
  return Object.fromEntries(
    variantes.map((v): [string, CostoSugerido] => {
      const precio = precioDe.get(v.productoId);
      if (precio?.moneda === Moneda.USDT)
        return [v.id, { costo: dec(precio.precio), fuente: "PROVEEDOR_USDT" }];
      const pesos = precio?.precio ?? v.ultimoCosto;
      const costo = pesos ? enUsdt(pesos, tipoCambio) : null;
      if (!pesos || !costo || !tipoCambio) return [v.id, { costo: null, fuente: null }];
      return [
        v.id,
        {
          costo,
          fuente: precio ? "PROVEEDOR" : "ULTIMO_COSTO",
          pesos: dec(pesos),
          tipoCambio: dec(tipoCambio),
        },
      ];
    }),
  );
}

export interface SaborCatalogoCompra {
  varianteId: string;
  /** null = sabor "Único" (no se muestra). */
  sabor: string | null;
  sku: string;
  /** Unidades en el galpón destino (null = no se indicó galpón). */
  stock: number | null;
}

export interface ProductoCatalogoCompra {
  productoId: string;
  nombreCompleto: string;
  marca: string;
  /** Precio del proveedor, en su moneda. */
  precio: string;
  moneda: Moneda;
  /**
   * Costo EN USDT que se precarga al agregarlo (igual que `costoSugerido`):
   * USDT tal cual; pesos ÷ cotización (la de la compra o la vigente).
   * null = está en pesos y no hay cotización.
   */
  costoUsdt: string | null;
  /** Solo precio en pesos con cotización: la cotización usada. */
  tipoCambio: string | null;
  actualizadoAt: Date;
  sabores: SaborCatalogoCompra[];
}

/**
 * Catálogo del proveedor para el formulario de compra: los productos que
 * vende (activos y no borrados) con su precio, el costo en USDT que se
 * precarga y sus sabores activos (con el stock del galpón destino si se
 * indica). Orden por marca y modelo. Solo para quien tiene `ver` en COMPRAS.
 */
export async function catalogoParaCompra(
  ctx: Ctx,
  proveedorId: string,
  opciones: { compraId?: string; depositoId?: string } = {},
): Promise<ProductoCatalogoCompra[]> {
  const db = dbPara(ctx.panelId);
  const [filas] = await Promise.all([
    db.proveedorProducto.findMany({
      where: {
        proveedorId,
        proveedor: { deletedAt: null },
        producto: { deletedAt: null, activo: true },
      },
      orderBy: [
        { producto: { marca: { nombre: "asc" } } },
        { producto: { nombre: "asc" } },
        { producto: { nombreCompleto: "asc" } },
      ],
      take: 1000,
      select: {
        precio: true,
        moneda: true,
        actualizadoAt: true,
        producto: {
          select: {
            id: true,
            nombreCompleto: true,
            marca: { select: { nombre: true } },
            variantes: {
              where: { deletedAt: null, activo: true },
              orderBy: { nombre: "asc" },
              select: {
                id: true,
                nombre: true,
                sku: true,
                stocks: opciones.depositoId
                  ? { where: { depositoId: opciones.depositoId }, select: { cantidad: true } }
                  : false,
              },
            },
          },
        },
      },
    }),
  ]);
  const tipoCambio = filas.some((f) => f.moneda !== Moneda.USDT)
    ? await cotizacionParaSugerir(ctx, opciones.compraId)
    : null;
  return filas.map((f) => {
    const enPesos = f.moneda !== Moneda.USDT;
    return {
      productoId: f.producto.id,
      nombreCompleto: f.producto.nombreCompleto,
      marca: f.producto.marca.nombre,
      precio: dec(f.precio),
      moneda: f.moneda,
      costoUsdt: enPesos ? enUsdt(f.precio, tipoCambio) : dec(f.precio),
      tipoCambio: enPesos && tipoCambio ? dec(tipoCambio) : null,
      actualizadoAt: f.actualizadoAt,
      sabores: f.producto.variantes.map((v) => ({
        varianteId: v.id,
        sabor: saborVisible(v.nombre),
        sku: v.sku,
        stock: opciones.depositoId ? (v.stocks?.[0]?.cantidad ?? 0) : null,
      })),
    };
  });
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
      // El precio queda en la moneda en que ya lo tenía el proveedor; si no
      // tenía, en USDT (moneda de Compras). En USDT, el costo tal como se
      // cargó; en pesos (o compra anterior sin costo en USDT), el de pesos.
      const usdt =
        (actual?.moneda ?? Moneda.USDT) === Moneda.USDT && item.costoUnitarioUSDT !== null;
      const costo = usdt ? item.costoUnitarioUSDT! : item.costoUnitario;
      const moneda = usdt ? Moneda.USDT : Moneda.ARS;
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
      // Costo final con el criterio vigente (pasista proporcional al precio): una
      // compra confirmada antes de A4 todavía tiene el recargo parejo guardado.
      await recalcularCostosFinales(tx, ctx, id);
      compra.items = await tx.compraItem.findMany({ where: { compraId: id } });

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
      costosEnUsdt: true,
      tipoCambioUSDT: true,
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          varianteId: true,
          cantidad: true,
          costoUnitario: true,
          costoUnitarioUSDT: true,
          costoUnitarioFinal: true,
        },
      },
      gastos: { where: { anulado: false }, select: { monto: true, montoUSDT: true } },
    },
  });
  if (!compra) throw new NotFoundError("La compra no existe");
  const comisionPorcentaje =
    opciones.comisionPorcentaje !== undefined
      ? opciones.comisionPorcentaje
      : (compra.comisionPasistaPorcentaje?.toFixed(2) ?? null);
  // Compra en USDT: se calcula en USDT y se pasa a pesos. Anterior: en pesos, como siempre.
  const usdt =
    compra.costosEnUsdt && compra.tipoCambioUSDT
      ? calcularCostosCompraUsdt({
          items: compra.items.map((i) => ({
            cantidad: i.cantidad,
            costoUnitarioUSDT: i.costoUnitarioUSDT
              ? i.costoUnitarioUSDT.toFixed(2)
              : pesosAMoneda(i.costoUnitario.toFixed(2), compra.tipoCambioUSDT!.toFixed(2)),
          })),
          comisionPorcentaje,
          gastos: gastosParaUsdt(compra.gastos, compra.tipoCambioUSDT),
          tipoCambioUSDT: compra.tipoCambioUSDT.toFixed(2),
        })
      : null;
  const costos =
    usdt?.pesos ??
    calcularCostosFinales({
      items: compra.items.map((i) => ({
        cantidad: i.cantidad,
        costoUnitario: i.costoUnitario.toFixed(2),
      })),
      descuento: compra.descuento.toFixed(2),
      comisionPorcentaje,
      gastos: compra.gastos.map((g) => g.monto.toFixed(2)),
    });
  await tx.compra.update({ where: { id: compraId }, data: columnasCostos(costos) });
  const finalDe = new Map<string, Prisma.Decimal>();
  for (const [n, item] of compra.items.entries()) {
    const final = decimal(
      usdt ? usdt.itemsPesos[n]!.costoUnitarioFinal : costos.items[n]!.costoUnitarioFinal,
    );
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
      tipoCambioUSDT: true,
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
  /** Montos EN USDT. */
  gastos: { motivo: string; montoUSDT: number }[],
): Promise<{ idVisible: string; costos: CostosFinales }> {
  if (gastos.length === 0) throw new DomainError("Cargá al menos un gasto");
  return transaccion(ctx, async (tx) => {
    const antes = await compraParaCostos(tx, ctx, compraId);
    // Los gastos se pasan a pesos con la cotización de la compra; una compra
    // anterior sin cotización guarda la vigente (y queda fija para la próxima).
    let tipoCambio = antes.tipoCambioUSDT;
    if (!tipoCambio) {
      tipoCambio = (await cotizacionesCompra({ tipoCambioUSDT: null, tipoCambioUSD: null })).usdt;
      await tx.compra.update({ where: { id: compraId }, data: { tipoCambioUSDT: tipoCambio } });
    }
    const ahora = new Date();
    for (const g of gastos) {
      await tx.gastoCompra.create({
        data: {
          compraId,
          motivo: g.motivo.trim(),
          montoUSDT: decimal(g.montoUSDT),
          monto: decimal(usdtAPesos(g.montoUSDT.toFixed(2), tipoCambio.toFixed(2))),
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
        tipoCambioUSDT: dec(tipoCambio),
        gastos: gastos.map((g) => ({ motivo: g.motivo, montoUSDT: g.montoUSDT.toFixed(2) })),
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
      select: {
        id: true,
        compraId: true,
        anulado: true,
        motivo: true,
        monto: true,
        montoUSDT: true,
      },
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
        montoUSDT: gasto.montoUSDT ? dec(gasto.montoUSDT) : null,
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
  /** En pesos. */
  monto: string;
  /** Como se cargó en USDT (null = gasto anterior, cargado en pesos). */
  montoUSDT: string | null;
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
  /** true = compra cargada en USDT (ver Compra.costosEnUsdt). */
  costosEnUsdt: boolean;
  /** Para recalcular en vivo con vistaCostosUsdt. */
  items: {
    cantidad: number;
    costoUnitario: string;
    costoUnitarioUSDT: string | null;
    costoUnitarioFinal: string;
  }[];
  gastos: GastoCompraDetalle[];
  /** Con la que se pasan los gastos a pesos (la guardada en la compra o la vigente). */
  cotizacionUsdt: CotizacionResumen | null;
}

export async function obtenerCostosCompra(ctx: Ctx, compraId: string): Promise<CostosCompra> {
  const c = await dbPara(ctx.panelId).compra.findUnique({
    where: { id: compraId },
    include: {
      items: {
        select: {
          cantidad: true,
          costoUnitario: true,
          costoUnitarioUSDT: true,
          costoUnitarioFinal: true,
        },
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
    costosEnUsdt: c.costosEnUsdt,
    items: c.items.map((i) => ({
      cantidad: i.cantidad,
      costoUnitario: dec(i.costoUnitario),
      costoUnitarioUSDT: i.costoUnitarioUSDT ? dec(i.costoUnitarioUSDT) : null,
      costoUnitarioFinal: dec(i.costoUnitarioFinal),
    })),
    gastos: c.gastos.map((g) => ({
      id: g.id,
      motivo: g.motivo,
      monto: dec(g.monto),
      montoUSDT: g.montoUSDT ? dec(g.montoUSDT) : null,
      fecha: g.fecha,
      usuario: g.usuario.nombre,
      anulado: g.anulado,
      motivoAnulacion: g.motivoAnulacion,
    })),
    cotizacionUsdt: await cotizacionResumenCompra(c.tipoCambioUSDT ? dec(c.tipoCambioUSDT) : null),
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
  /** Cotización USDT guardada en la compra (null si no tiene). */
  tipoCambioUSDT: string | null;
  /** Los costos en USDT (moneda de Compras); null sin ninguna cotización USDT. */
  usdt: VistaCostosUsdt | null;
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
        items: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            cantidad: true,
            costoUnitario: true,
            costoUnitarioUSDT: true,
            costoUnitarioFinal: true,
          },
        },
        gastos: { select: { monto: true, montoUSDT: true, anulado: true } },
      },
    }),
  ]);
  const vigente = filas.some((c) => !c.tipoCambioUSDT) ? await cotizacionResumenCompra(null) : null;
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
      tipoCambioUSDT: c.tipoCambioUSDT ? dec(c.tipoCambioUSDT) : null,
      usdt: vistaDe(
        c,
        c.tipoCambioUSDT ? { valor: Number(c.tipoCambioUSDT), origen: "guardada" } : vigente,
      ),
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
  /** Lo cargado en USDT (null en compras anteriores con el producto en pesos). */
  costoUnitarioUSDT: string | null;
  subtotal: string;
  /** Costo con la comisión y los gastos prorrateados por unidad. */
  costoUnitarioFinal: string;
}

export interface CompraDetalle extends Omit<CompraListada, "items" | "usdt"> {
  /** true = compra cargada en USDT (ver Compra.costosEnUsdt). */
  costosEnUsdt: boolean;
  /** Dólar blue guardado en la compra (null = compra anterior). */
  tipoCambioUSD: string | null;
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
      montoUSDT: g.montoUSDT ? dec(g.montoUSDT) : null,
      fecha: g.fecha,
      usuario: g.usuario.nombre,
      anulado: g.anulado,
      motivoAnulacion: g.motivoAnulacion,
    })),
    notas: c.notas,
    costosEnUsdt: c.costosEnUsdt,
    tipoCambioUSDT: c.tipoCambioUSDT ? dec(c.tipoCambioUSDT) : null,
    tipoCambioUSD: c.tipoCambioUSD ? dec(c.tipoCambioUSD) : null,
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
