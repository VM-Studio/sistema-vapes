import { Prisma, TipoMovimiento, type MovimientoStock } from "@prisma/client";
import { z } from "zod";

import { dbPara, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { formatearIdCompra, rutaPanel } from "@/lib/paneles";
import { ahora } from "@/lib/reloj";
import { nombreConSabor } from "@/lib/ventas-ui";
import { DomainError, NotFoundError, StockInsuficienteError } from "@/server/errors";
import {
  depositosActivosPanel,
  filtrosStockSchema,
  obtenerStock,
  type DepositoStock,
  type ResultadoStock,
} from "@/server/services/inventario.service";

/**
 * MOTOR DE STOCK
 *
 * Única puerta de entrada para modificar stock. Garantías:
 * - Siempre dentro de una transacción del panel (recibe el `tx` de
 *   `transaccion(ctx, ...)`, que ya confina toda query al panel).
 * - SELECT ... FOR UPDATE sobre la fila de Stock: dos operaciones concurrentes
 *   sobre la misma variante/depósito se serializan, no se pisan.
 * - Inserta el MovimientoStock (ledger) y actualiza Stock (caché) en la misma tx.
 *
 * La DB lo refuerza con triggers: un UPDATE a Stock sin movimiento en la misma
 * transacción es rechazado, y el movimiento debe partir del stock real.
 */

export type ReferenciaTipo = "VENTA" | "COMPRA" | "TRANSFERENCIA" | "AJUSTE" | "DEVOLUCION";

const TIPOS_ENTRADA: ReadonlySet<TipoMovimiento> = new Set([
  TipoMovimiento.INGRESO_COMPRA,
  TipoMovimiento.INGRESO_MANUAL,
  TipoMovimiento.DEVOLUCION_CLIENTE,
  TipoMovimiento.AJUSTE_POSITIVO,
  TipoMovimiento.TRANSFERENCIA_ENTRADA,
  TipoMovimiento.GARANTIA_ANULADA,
  TipoMovimiento.VENTA_ANULADA,
]);

/** +1 si el tipo suma stock, -1 si resta. Espejo de fn_signo_movimiento() en SQL. */
export function signoMovimiento(tipo: TipoMovimiento): 1 | -1 {
  return TIPOS_ENTRADA.has(tipo) ? 1 : -1;
}

export interface RegistrarMovimientoInput {
  tipo: TipoMovimiento;
  varianteId: string;
  depositoId: string;
  /** Siempre > 0; el signo lo define `tipo`. */
  cantidad: number;
  usuarioId: string;
  costoUnitario?: Prisma.Decimal | number | string | null;
  motivo?: string | null;
  referenciaTipo?: ReferenciaTipo | null;
  referenciaId?: string | null;
}

export interface TransferirStockInput {
  varianteId: string;
  depositoOrigenId: string;
  depositoDestinoId: string;
  cantidad: number;
  usuarioId: string;
  motivo?: string | null;
  /** Id de la Transferencia (documento) que origina el movimiento, si existe. */
  referenciaId?: string | null;
}

interface FilaStockBloqueada {
  id: string;
  depositoId: string;
  cantidad: number;
}

function assertEnTransaccion(tx: Tx): void {
  // El cliente raíz expone $transaction; el cliente de una transacción interactiva no.
  if (typeof (tx as { $transaction?: unknown }).$transaction === "function") {
    throw new Error(
      "El motor de stock solo puede usarse dentro de una transacción (transaccion(ctx, ...)).",
    );
  }
}

function assertCantidad(cantidad: number): void {
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
    throw new DomainError(`La cantidad debe ser un entero positivo (recibido: ${cantidad}).`);
  }
}

/**
 * Crea (si faltan) y bloquea con FOR UPDATE las filas de Stock de una variante
 * en uno o más depósitos. Bloquea SIEMPRE en orden de depositoId para que dos
 * operaciones cruzadas (ej: transferencias A→B y B→A) no hagan deadlock.
 *
 * Para operaciones con muchos ítems (ventas, compras), llamar antes a esta
 * función con los ítems ordenados por varianteId por el mismo motivo.
 *
 * SQL cruda: no pasa por dbPara, así que filtra por `panelId` a mano.
 */
export async function bloquearStock(
  tx: Tx,
  panelId: string,
  varianteId: string,
  depositoIds: string[],
): Promise<Map<string, FilaStockBloqueada>> {
  const ids = [...new Set(depositoIds)].sort();

  const seleccionarParaActualizar = () => tx.$queryRaw<FilaStockBloqueada[]>`
    SELECT "id", "depositoId", "cantidad"
    FROM "Stock"
    WHERE "panelId" = ${panelId}
      AND "varianteId" = ${varianteId}
      AND "depositoId" IN (${Prisma.join(ids)})
    ORDER BY "depositoId"
    FOR UPDATE
  `;

  let filas = await seleccionarParaActualizar();

  if (filas.length < ids.length) {
    // Primera vez que esta variante pisa ese depósito: crear la fila en 0.
    // ON CONFLICT DO NOTHING tolera que otra transacción la cree en paralelo.
    // (Se hace solo si falta: bajo Serializable, el INSERT sobre una fila que
    // otra tx está modificando provoca conflictos de serialización evitables.)
    // panelId lo completa el tx del panel; los triggers verifican que variante
    // y depósito sean de ese mismo panel.
    await tx.stock.createMany({
      data: ids.map((depositoId) => ({ varianteId, depositoId, cantidad: 0 })),
      skipDuplicates: true,
    });
    filas = await seleccionarParaActualizar();
  }

  return new Map(filas.map((f) => [f.depositoId, f]));
}

/** Nombres para los mensajes y el panel de la variante (el tx ya garantiza que es del panel). */
async function describir(tx: Tx, varianteId: string, depositoId: string) {
  const [variante, deposito] = await Promise.all([
    tx.variante.findUnique({
      where: { id: varianteId },
      select: {
        panelId: true,
        nombre: true,
        producto: { select: { nombreCompleto: true } },
      },
    }),
    tx.deposito.findUnique({ where: { id: depositoId }, select: { nombre: true, activo: true } }),
  ]);
  if (!variante) throw new NotFoundError(`No existe la variante ${varianteId}.`);
  if (!deposito) throw new NotFoundError(`No existe el depósito ${depositoId}.`);

  const nombreVariante = nombreConSabor(variante.producto.nombreCompleto, variante.nombre);
  return { panelId: variante.panelId, nombreVariante, nombreDeposito: deposito.nombre };
}

/**
 * Registra un movimiento de stock y actualiza el caché de Stock atómicamente.
 * Lanza StockInsuficienteError si el resultado quedaría negativo.
 */
export async function registrarMovimiento(
  tx: Tx,
  input: RegistrarMovimientoInput,
): Promise<MovimientoStock> {
  assertEnTransaccion(tx);
  assertCantidad(input.cantidad);
  if ((input.referenciaTipo == null) !== (input.referenciaId == null)) {
    throw new DomainError("referenciaTipo y referenciaId van juntos.");
  }

  const { panelId, nombreVariante, nombreDeposito } = await describir(
    tx,
    input.varianteId,
    input.depositoId,
  );

  const filas = await bloquearStock(tx, panelId, input.varianteId, [input.depositoId]);
  const fila = filas.get(input.depositoId);
  if (!fila) throw new Error("No se pudo bloquear la fila de stock."); // no debería ocurrir

  const stockAnterior = fila.cantidad;
  const stockPosterior = stockAnterior + signoMovimiento(input.tipo) * input.cantidad;

  if (stockPosterior < 0) {
    throw new StockInsuficienteError(nombreVariante, nombreDeposito, stockAnterior, input.cantidad);
  }

  // Orden importante: primero el ledger (el trigger habilita el UPDATE de
  // Stock para exactamente esta transición), después el caché.
  const movimiento = await tx.movimientoStock.create({
    data: {
      tipo: input.tipo,
      varianteId: input.varianteId,
      depositoId: input.depositoId,
      cantidad: input.cantidad,
      stockAnterior,
      stockPosterior,
      costoUnitario: input.costoUnitario ?? null,
      motivo: input.motivo ?? null,
      referenciaTipo: input.referenciaTipo ?? null,
      referenciaId: input.referenciaId ?? null,
      usuarioId: input.usuarioId,
      createdAt: ahora(),
    },
  });

  await tx.stock.update({ where: { id: fila.id }, data: { cantidad: stockPosterior } });

  return movimiento;
}

/**
 * Mueve stock entre depósitos: TRANSFERENCIA_SALIDA en origen +
 * TRANSFERENCIA_ENTRADA en destino, en la misma transacción. Si la salida
 * falla (stock insuficiente), no se registra nada.
 */
export async function transferirStock(
  tx: Tx,
  input: TransferirStockInput,
): Promise<{ salida: MovimientoStock; entrada: MovimientoStock }> {
  assertEnTransaccion(tx);
  assertCantidad(input.cantidad);
  if (input.depositoOrigenId === input.depositoDestinoId) {
    throw new DomainError("El depósito de origen y el de destino deben ser distintos.");
  }

  // Bloqueo de ambas filas en orden determinístico antes de mover nada.
  const { panelId } = await describir(tx, input.varianteId, input.depositoOrigenId);
  await bloquearStock(tx, panelId, input.varianteId, [
    input.depositoOrigenId,
    input.depositoDestinoId,
  ]);

  const referencia = input.referenciaId
    ? { referenciaTipo: "TRANSFERENCIA" as const, referenciaId: input.referenciaId }
    : {};

  const salida = await registrarMovimiento(tx, {
    tipo: TipoMovimiento.TRANSFERENCIA_SALIDA,
    varianteId: input.varianteId,
    depositoId: input.depositoOrigenId,
    cantidad: input.cantidad,
    usuarioId: input.usuarioId,
    motivo: input.motivo,
    ...referencia,
  });

  const entrada = await registrarMovimiento(tx, {
    tipo: TipoMovimiento.TRANSFERENCIA_ENTRADA,
    varianteId: input.varianteId,
    depositoId: input.depositoDestinoId,
    cantidad: input.cantidad,
    usuarioId: input.usuarioId,
    motivo: input.motivo,
    ...referencia,
  });

  return { salida, entrada };
}

/** Stock total de una variante sumando todos los depósitos del panel del `tx`. */
export async function stockTotalVariante(tx: Tx, varianteId: string): Promise<number> {
  const r = await tx.stock.aggregate({ where: { varianteId }, _sum: { cantidad: true } });
  return r._sum.cantidad ?? 0;
}

// =============================================================================
// LECTURAS (pantalla Stock): por galpón, global, ledger y resumen.
// No escriben nada: toda escritura pasa por el motor de arriba.
// =============================================================================

export interface FiltrosLecturaStock {
  /** Producto, sabor, SKU o código de barras. */
  q?: string;
  marcaId?: string;
  soloBajoMinimo?: boolean;
  /** Global: agrupar por producto (pagina por producto). */
  porProducto?: boolean;
  page?: number;
  pageSize?: number;
}

function filtrosInventario(f: FiltrosLecturaStock, depositoId?: string) {
  return filtrosStockSchema.parse({
    q: f.q || undefined,
    marcaId: f.marcaId || undefined,
    depositoId,
    soloBajoMinimo: f.soloBajoMinimo ?? false,
    agruparPorProducto: f.porProducto ?? false,
    page: f.page ?? 1,
    pageSize: f.pageSize ?? 50,
  });
}

/**
 * Stock de UN galpón del panel: una fila por sabor con la cantidad en ese
 * galpón, el mínimo y el estado (contra la cantidad del galpón). Un depósito
 * que no es del panel (o está inactivo) da NotFoundError.
 */
export async function stockPorDeposito(
  ctx: Ctx,
  depositoId: string,
  filtros: FiltrosLecturaStock = {},
): Promise<ResultadoStock & { deposito: DepositoStock }> {
  const r = await obtenerStock(ctx, filtrosInventario(filtros, depositoId));
  if (!r.deposito) throw new NotFoundError("El galpón no existe o está inactivo.");
  return { ...r, deposito: r.deposito };
}

/**
 * Stock consolidado del panel (vw_stock_consolidado): por sabor, la cantidad
 * en cada depósito activo + total + mínimo + estado (contra el total).
 */
export async function stockGlobal(
  ctx: Ctx,
  filtros: FiltrosLecturaStock = {},
): Promise<ResultadoStock> {
  return obtenerStock(ctx, filtrosInventario(filtros));
}

export interface ResumenStockPanel {
  porDeposito: (DepositoStock & { unidades: number; bajoMinimo: number })[];
  /** Unidades en todos los galpones. */
  total: number;
  /** Sabores activos con total del panel por debajo del mínimo. */
  bajoMinimo: number;
}

const resumenSqlSchema = z.array(
  z.object({
    deposito_id: z.string(),
    unidades: z.union([z.bigint(), z.number()]).transform(Number),
    bajo: z.union([z.bigint(), z.number()]).transform(Number),
  }),
);
const conteoSqlSchema = z.array(
  z.object({ bajo: z.union([z.bigint(), z.number()]).transform(Number) }),
);

/**
 * Unidades por galpón y total, y cuántos sabores activos están bajo el mínimo
 * (por galpón: la cantidad del galpón; global: el total del panel).
 * SQL cruda: filtra el panel a mano.
 */
export async function resumenStock(ctx: Ctx): Promise<ResumenStockPanel> {
  const db = dbPara(ctx.panelId);
  const depositos = await depositosActivosPanel(ctx);
  const [porDeposito, global] = await Promise.all([
    db.$queryRaw`
      SELECT d."id" AS deposito_id,
             COALESCE(SUM(COALESCE((s.por_deposito ->> d."id")::int, 0)), 0) AS unidades,
             COUNT(*) FILTER (
               WHERE v."activo" AND p."activo"
                 AND COALESCE((s.por_deposito ->> d."id")::int, 0) < s.stock_minimo
             ) AS bajo
      FROM "Deposito" d
      CROSS JOIN vw_stock_consolidado s
      JOIN "Variante" v ON v."id" = s.variante_id
      JOIN "Producto" p ON p."id" = s.producto_id
      WHERE d."panelId" = ${ctx.panelId} AND d."activo" AND s.panel_id = ${ctx.panelId}
      GROUP BY d."id"`,
    db.$queryRaw`
      SELECT COUNT(*) AS bajo FROM vw_alertas_stock WHERE panel_id = ${ctx.panelId}`,
  ]);
  const filas = new Map(resumenSqlSchema.parse(porDeposito).map((f) => [f.deposito_id, f]));
  const lista = depositos.map((d) => ({
    ...d,
    unidades: filas.get(d.id)?.unidades ?? 0,
    bajoMinimo: filas.get(d.id)?.bajo ?? 0,
  }));
  return {
    porDeposito: lista,
    total: lista.reduce((a, d) => a + d.unidades, 0),
    bajoMinimo: conteoSqlSchema.parse(global)[0]?.bajo ?? 0,
  };
}

// -----------------------------------------------------------------------------
// Ledger
// -----------------------------------------------------------------------------

export interface ReferenciaMovimiento {
  tipo: string;
  id: string;
  /** Código visible (VAP-000001, VAP-C-000001, VAP-D-000001, Transferencia #3). */
  etiqueta: string;
  /** Ruta completa (/p/{slug}/...) a la pantalla del documento, cuando existe. */
  href: string | null;
}

export interface MovimientoListado {
  id: string;
  fecha: Date;
  tipo: TipoMovimiento;
  /** Cantidad con signo (+ entra, − sale). */
  cantidad: number;
  stockAnterior: number;
  stockPosterior: number;
  varianteId: string;
  productoId: string;
  /** "Producto — sabor" (solo el producto si no tiene sabores). */
  nombre: string;
  sku: string;
  depositoId: string;
  deposito: string;
  usuario: string;
  /** Solo para dueños (opciones.incluirCostos); null para el resto. */
  costoUnitario: string | null;
  motivo: string | null;
  referencia: ReferenciaMovimiento | null;
}

export interface FiltrosLedger {
  /** null / undefined = todos los galpones del panel. */
  depositoId?: string | null;
  varianteId?: string;
  productoId?: string;
  tipo?: TipoMovimiento;
  usuarioId?: string;
  referenciaTipo?: ReferenciaTipo;
  referenciaId?: string;
  desde?: Date;
  hasta?: Date;
  page?: number;
  pageSize?: number;
}

export interface ResultadoLedger {
  movimientos: MovimientoListado[];
  total: number;
  page: number;
  pageSize: number;
}

function whereLedger(f: FiltrosLedger): Prisma.MovimientoStockWhereInput {
  const where: Prisma.MovimientoStockWhereInput = {};
  if (f.varianteId) where.varianteId = f.varianteId;
  if (f.productoId) where.variante = { productoId: f.productoId };
  if (f.depositoId) where.depositoId = f.depositoId;
  if (f.usuarioId) where.usuarioId = f.usuarioId;
  if (f.tipo) where.tipo = f.tipo;
  if (f.referenciaTipo) where.referenciaTipo = f.referenciaTipo;
  if (f.referenciaId) where.referenciaId = f.referenciaId;
  if (f.desde || f.hasta) {
    where.createdAt = {
      ...(f.desde ? { gte: f.desde } : {}),
      ...(f.hasta ? { lte: f.hasta } : {}),
    };
  }
  return where;
}

/** Códigos visibles y links de las referencias, resueltos en lote (sin N+1). */
async function resolverReferencias(
  ctx: Ctx,
  movs: { referenciaTipo: string | null; referenciaId: string | null }[],
): Promise<Map<string, ReferenciaMovimiento>> {
  const mapa = new Map<string, ReferenciaMovimiento>();
  if (!movs.some((m) => m.referenciaTipo && m.referenciaId)) return mapa;
  const db = dbPara(ctx.panelId);
  const ids = (tipo: ReferenciaTipo) => [
    ...new Set(movs.filter((m) => m.referenciaTipo === tipo).map((m) => m.referenciaId!)),
  ];
  const [panel, transferencias, ventas, compras, devoluciones] = await Promise.all([
    db.panel.findUniqueOrThrow({ where: { id: ctx.panelId }, select: { slug: true } }),
    db.transferencia.findMany({
      where: { id: { in: ids("TRANSFERENCIA") } },
      select: { id: true, numero: true },
    }),
    db.venta.findMany({ where: { id: { in: ids("VENTA") } }, select: { id: true, codigo: true } }),
    db.compra.findMany({
      where: { id: { in: ids("COMPRA") } },
      select: { id: true, numero: true },
    }),
    db.devolucion.findMany({
      where: { id: { in: ids("DEVOLUCION") } },
      select: { id: true, codigo: true },
    }),
  ]);
  const ruta = (r: string) => rutaPanel(panel.slug, r);
  for (const t of transferencias)
    mapa.set(`TRANSFERENCIA:${t.id}`, {
      tipo: "TRANSFERENCIA",
      id: t.id,
      etiqueta: `Transferencia #${t.numero}`,
      href: ruta(`/stock/movimientos/transferencias/${t.id}`),
    });
  for (const v of ventas)
    mapa.set(`VENTA:${v.id}`, {
      tipo: "VENTA",
      id: v.id,
      etiqueta: v.codigo,
      href: ruta(`/ventas/${v.id}`),
    });
  for (const c of compras)
    mapa.set(`COMPRA:${c.id}`, {
      tipo: "COMPRA",
      id: c.id,
      etiqueta: formatearIdCompra(panel.slug, c.numero),
      href: ruta(`/compras/${c.id}`),
    });
  for (const d of devoluciones)
    mapa.set(`DEVOLUCION:${d.id}`, {
      tipo: "DEVOLUCION",
      id: d.id,
      etiqueta: d.codigo,
      href: ruta(`/devoluciones/${d.id}`),
    });
  for (const m of movs)
    if (m.referenciaTipo === "AJUSTE" && m.referenciaId)
      mapa.set(`AJUSTE:${m.referenciaId}`, {
        tipo: "AJUSTE",
        id: m.referenciaId,
        etiqueta: "Ajuste",
        href: null,
      });
  return mapa;
}

/**
 * Ledger del panel paginado, más nuevo primero: producto — sabor, galpón,
 * cantidad con signo, anterior → posterior, usuario y referencia (código
 * visible + link). Sin depósito = todos los galpones. El costo unitario solo
 * viaja con `incluirCostos` (dueños).
 */
export async function movimientos(
  ctx: Ctx,
  filtros: FiltrosLedger = {},
  opciones: { incluirCostos?: boolean } = {},
): Promise<ResultadoLedger> {
  const db = dbPara(ctx.panelId);
  const page = Math.max(1, filtros.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filtros.pageSize ?? 50));
  const where = whereLedger(filtros);
  const [total, filas] = await Promise.all([
    db.movimientoStock.count({ where }),
    db.movimientoStock.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        variante: {
          select: {
            nombre: true,
            sku: true,
            productoId: true,
            producto: { select: { nombreCompleto: true } },
          },
        },
        deposito: { select: { nombre: true } },
        usuario: { select: { nombre: true } },
      },
    }),
  ]);
  const refs = await resolverReferencias(ctx, filas);
  return {
    movimientos: filas.map((m) => ({
      id: m.id,
      fecha: m.createdAt,
      tipo: m.tipo,
      cantidad: signoMovimiento(m.tipo) * m.cantidad,
      stockAnterior: m.stockAnterior,
      stockPosterior: m.stockPosterior,
      varianteId: m.varianteId,
      productoId: m.variante.productoId,
      nombre: nombreConSabor(m.variante.producto.nombreCompleto, m.variante.nombre),
      sku: m.variante.sku,
      depositoId: m.depositoId,
      deposito: m.deposito.nombre,
      usuario: m.usuario.nombre,
      costoUnitario: opciones.incluirCostos && m.costoUnitario ? m.costoUnitario.toFixed(2) : null,
      motivo: m.motivo,
      referencia:
        m.referenciaTipo && m.referenciaId
          ? (refs.get(`${m.referenciaTipo}:${m.referenciaId}`) ?? null)
          : null,
    })),
    total,
    page,
    pageSize,
  };
}
