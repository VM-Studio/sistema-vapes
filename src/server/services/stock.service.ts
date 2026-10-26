import { Prisma, TipoMovimiento, type MovimientoStock } from "@prisma/client";
import { z } from "zod";

import { dbPara, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { FAMILIAS_MOVIMIENTO, type FamiliaMovimiento } from "@/lib/movimientos-ui";
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

/**
 * Lista única de productos para todos los galpones: al crear un sabor, crea su
 * fila de Stock en 0 en cada galpón activo del panel (sin movimiento: una fila
 * en 0 no cambia nada del ledger). Las lecturas igual usan LEFT JOIN, así que
 * un galpón sin fila también muestra 0. ON CONFLICT DO NOTHING (idempotente).
 */
export async function crearStockEnCero(tx: Tx, varianteIds: string[]): Promise<void> {
  assertEnTransaccion(tx);
  if (varianteIds.length === 0) return;
  const depositos = await tx.deposito.findMany({ where: { activo: true }, select: { id: true } });
  if (depositos.length === 0) return;
  await tx.stock.createMany({
    data: varianteIds.flatMap((varianteId) =>
      depositos.map((d) => ({ varianteId, depositoId: d.id, cantidad: 0 })),
    ),
    skipDuplicates: true,
  });
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
  /** Modelo / gusto / pitadas normalizados (ver opcionesFiltrosStock). */
  modelo?: string;
  gusto?: string;
  pitadas?: string;
  /** Tarjeta elegida: sabores con esa cantidad > 0. */
  ver?: "disponible" | "escaneado" | "retirado";
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
    modelo: f.modelo || undefined,
    gusto: f.gusto || undefined,
    pitadas: f.pitadas || undefined,
    ver: f.ver,
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
  /** Código visible (VAP-000001, VAP-C-000001, VAP-D-000001, VAP-T-000001). */
  etiqueta: string;
  /** Ruta completa (/p/{slug}/...) a la pantalla del documento, cuando existe. */
  href: string | null;
  /** Contraparte, para el texto: cliente (ventas, devoluciones), proveedor (compras). */
  contraparte?: string | null;
  /** Transferencias: galpón de origen y de destino. */
  origen?: string;
  destino?: string;
}

export interface MovimientoListado {
  id: string;
  /**
   * MOVIMIENTO = fila del ledger (cambia la cantidad). RETIRO = el cliente se
   * llevó lo vendido (informativo: la cantidad ya se descontó en la VENTA).
   */
  evento: "MOVIMIENTO" | "RETIRO";
  fecha: Date;
  /** En un RETIRO: VENTA (el movimiento al que corresponde). */
  tipo: TipoMovimiento;
  /** Cantidad con signo (+ entra, − sale). En un RETIRO: las unidades retiradas (sin signo). */
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
  /** Texto fácil: "Venta VAP-000123 a Juan", "Transferencia VAP-T-000004 a Mercedes"… */
  descripcion: string;
}

export interface FiltrosLedger {
  /** null / undefined = todos los galpones del panel. */
  depositoId?: string | null;
  varianteId?: string;
  productoId?: string;
  tipo?: TipoMovimiento;
  /** Entradas, salidas, ventas, compras, ajustes, transferencias, devoluciones o retiros. */
  familia?: FamiliaMovimiento;
  /** Producto, sabor o SKU. */
  q?: string;
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

/** Timestamps SIN zona (UTC) contra la sesión en hora argentina: ver venta.service. */
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

function condicionTexto(q: string | undefined): Prisma.Sql | null {
  const palabras = (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (palabras.length === 0) return null;
  return Prisma.join(
    palabras.map((w) => {
      const patron = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return Prisma.sql`(p."nombreCompleto" ILIKE ${patron} OR v."nombre" ILIKE ${patron} OR v."sku" ILIKE ${patron})`;
    }),
    " AND ",
  );
}

/** Condiciones del ledger (SQL cruda: el panel va a mano). */
function whereMovimientosSql(ctx: Ctx, f: FiltrosLedger): Prisma.Sql | null {
  const c: Prisma.Sql[] = [Prisma.sql`m."panelId" = ${ctx.panelId}`];
  if (f.varianteId) c.push(Prisma.sql`m."varianteId" = ${f.varianteId}`);
  if (f.productoId) c.push(Prisma.sql`v."productoId" = ${f.productoId}`);
  if (f.depositoId) c.push(Prisma.sql`m."depositoId" = ${f.depositoId}`);
  if (f.usuarioId) c.push(Prisma.sql`m."usuarioId" = ${f.usuarioId}`);
  if (f.tipo) c.push(Prisma.sql`m."tipo"::text = ${f.tipo}`);
  if (f.familia) {
    const tipos = FAMILIAS_MOVIMIENTO[f.familia].tipos as readonly string[];
    if (tipos.length === 0) return null;
    c.push(Prisma.sql`m."tipo"::text IN (${Prisma.join([...tipos])})`);
  }
  if (f.referenciaTipo) c.push(Prisma.sql`m."referenciaTipo" = ${f.referenciaTipo}`);
  if (f.referenciaId) c.push(Prisma.sql`m."referenciaId" = ${f.referenciaId}`);
  if (f.desde) c.push(Prisma.sql`m."createdAt" >= ${utc(f.desde)}`);
  if (f.hasta) c.push(Prisma.sql`m."createdAt" <= ${utc(f.hasta)}`);
  const texto = condicionTexto(f.q);
  if (texto) c.push(texto);
  return Prisma.join(c, " AND ");
}

/**
 * Condiciones de los retiros (una fila por ítem de venta retirada), o null si
 * los filtros los excluyen (un tipo de movimiento puntual, otra referencia,
 * una familia sin retiros). Los retiros del histórico que marcó la migración
 * (retiradaAt = fecha de la venta) no se listan: serían un duplicado de la VENTA.
 */
function whereRetirosSql(ctx: Ctx, f: FiltrosLedger): Prisma.Sql | null {
  if (f.tipo) return null;
  if (f.familia && !FAMILIAS_MOVIMIENTO[f.familia].retiros) return null;
  if (f.referenciaTipo && f.referenciaTipo !== "VENTA") return null;
  const c: Prisma.Sql[] = [
    Prisma.sql`ve."panelId" = ${ctx.panelId}`,
    Prisma.sql`vi."panelId" = ${ctx.panelId}`,
    Prisma.sql`ve."estado" = 'CONFIRMADA'`,
    Prisma.sql`ve."retiradaAt" IS NOT NULL`,
    Prisma.sql`ve."retiradaAt" > ve."fecha"`,
  ];
  if (f.varianteId) c.push(Prisma.sql`vi."varianteId" = ${f.varianteId}`);
  if (f.productoId) c.push(Prisma.sql`vi."productoId" = ${f.productoId}`);
  if (f.depositoId) c.push(Prisma.sql`ve."depositoId" = ${f.depositoId}`);
  if (f.usuarioId) c.push(Prisma.sql`ve."retiradaPorId" = ${f.usuarioId}`);
  if (f.referenciaId) c.push(Prisma.sql`ve."id" = ${f.referenciaId}`);
  if (f.desde) c.push(Prisma.sql`ve."retiradaAt" >= ${utc(f.desde)}`);
  if (f.hasta) c.push(Prisma.sql`ve."retiradaAt" <= ${utc(f.hasta)}`);
  const texto = condicionTexto(f.q);
  if (texto) c.push(texto);
  return Prisma.join(c, " AND ");
}

const paginaSqlSchema = z.array(
  z.object({
    clase: z.enum(["M", "R"]),
    id: z.string(),
    total: z.union([z.bigint(), z.number()]).transform(Number),
  }),
);

/** Códigos visibles, contrapartes y links de las referencias, resueltos en lote (sin N+1). */
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
      select: {
        id: true,
        codigo: true,
        depositoOrigen: { select: { nombre: true } },
        depositoDestino: { select: { nombre: true } },
      },
    }),
    db.venta.findMany({
      where: { id: { in: ids("VENTA") } },
      select: { id: true, codigo: true, cliente: { select: { nombre: true } } },
    }),
    db.compra.findMany({
      where: { id: { in: ids("COMPRA") } },
      select: { id: true, numero: true, proveedor: { select: { nombre: true } } },
    }),
    db.devolucion.findMany({
      where: { id: { in: ids("DEVOLUCION") } },
      select: { id: true, codigo: true, cliente: { select: { nombre: true } } },
    }),
  ]);
  const ruta = (r: string) => rutaPanel(panel.slug, r);
  for (const t of transferencias)
    mapa.set(`TRANSFERENCIA:${t.id}`, {
      tipo: "TRANSFERENCIA",
      id: t.id,
      etiqueta: t.codigo,
      href: ruta(`/stock/transferencias/${t.id}`),
      origen: t.depositoOrigen.nombre,
      destino: t.depositoDestino.nombre,
    });
  for (const v of ventas)
    mapa.set(`VENTA:${v.id}`, {
      tipo: "VENTA",
      id: v.id,
      etiqueta: v.codigo,
      href: ruta(`/ventas/${v.id}`),
      contraparte: v.cliente.nombre,
    });
  for (const c of compras)
    mapa.set(`COMPRA:${c.id}`, {
      tipo: "COMPRA",
      id: c.id,
      etiqueta: formatearIdCompra(panel.slug, c.numero),
      href: ruta(`/compras/${c.id}`),
      contraparte: c.proveedor?.nombre ?? null,
    });
  for (const d of devoluciones)
    mapa.set(`DEVOLUCION:${d.id}`, {
      tipo: "DEVOLUCION",
      id: d.id,
      etiqueta: d.codigo,
      href: ruta(`/devoluciones/${d.id}`),
      contraparte: d.cliente.nombre,
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

/** "Venta VAP-000123 a Juan", "Compra VAP-C-000004 de Proveedor X"… (sin la cantidad). */
export function describirMovimiento(
  tipo: TipoMovimiento,
  ref: ReferenciaMovimiento | null,
  evento: MovimientoListado["evento"] = "MOVIMIENTO",
): string {
  const a = (quien: string | null | undefined) => (quien ? ` a ${quien}` : "");
  const de = (quien: string | null | undefined) => (quien ? ` de ${quien}` : "");
  const cod = ref ? ` ${ref.etiqueta}` : "";
  if (evento === "RETIRO") return `Retirado (venta${cod}${a(ref?.contraparte)})`;
  switch (tipo) {
    case TipoMovimiento.VENTA:
      return `Venta${cod}${a(ref?.contraparte)}`;
    case TipoMovimiento.VENTA_ANULADA:
      return `Anulación de la venta${cod}${ref?.contraparte ? ` (${ref.contraparte})` : ""}`;
    case TipoMovimiento.INGRESO_COMPRA:
      return `Compra${cod}${de(ref?.contraparte)}`;
    case TipoMovimiento.DEVOLUCION_PROVEEDOR:
      return `Devolución al proveedor${ref?.contraparte ? ` ${ref.contraparte}` : ""}${ref ? ` (${ref.etiqueta})` : ""}`;
    case TipoMovimiento.TRANSFERENCIA_SALIDA:
      return `Transferencia${cod}${ref?.destino ? ` a ${ref.destino}` : " (salida)"}`;
    case TipoMovimiento.TRANSFERENCIA_ENTRADA:
      return `Transferencia${cod}${ref?.origen ? ` desde ${ref.origen}` : " (entrada)"}`;
    case TipoMovimiento.GARANTIA:
      return `Garantía${cod}${a(ref?.contraparte)}`;
    case TipoMovimiento.GARANTIA_ANULADA:
      return `Garantía anulada${cod}`;
    case TipoMovimiento.DEVOLUCION_CLIENTE:
      return `Devolución de cliente${cod}${ref?.contraparte ? ` (${ref.contraparte})` : ""}`;
    case TipoMovimiento.INGRESO_MANUAL:
      return "Ingreso manual";
    case TipoMovimiento.AJUSTE_POSITIVO:
      return "Ajuste de stock (sobrante)";
    case TipoMovimiento.AJUSTE_NEGATIVO:
      return "Ajuste de stock (faltante)";
  }
}

/**
 * Ledger del panel paginado, más nuevo primero: producto — sabor, galpón,
 * cantidad con signo, anterior → posterior, usuario, referencia (código
 * visible + link) y un texto fácil ("Venta VAP-000123 a Juan"). Sin depósito
 * = todos los galpones. El costo unitario solo viaja con `incluirCostos`
 * (dueños). Con `incluirRetiros`, mezcla por fecha los retiros de ventas
 * (eventos sin cambio de cantidad).
 */
export async function movimientos(
  ctx: Ctx,
  filtros: FiltrosLedger = {},
  opciones: { incluirCostos?: boolean; incluirRetiros?: boolean } = {},
): Promise<ResultadoLedger> {
  const db = dbPara(ctx.panelId);
  const page = Math.max(1, filtros.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filtros.pageSize ?? 50));
  const condMovs = whereMovimientosSql(ctx, filtros);
  const condRet = opciones.incluirRetiros ? whereRetirosSql(ctx, filtros) : null;
  const partes: Prisma.Sql[] = [];
  if (condMovs)
    partes.push(Prisma.sql`
      SELECT 'M' AS clase, m."id", m."createdAt" AS fecha
      FROM "MovimientoStock" m
      JOIN "Variante" v ON v."id" = m."varianteId"
      JOIN "Producto" p ON p."id" = v."productoId"
      WHERE ${condMovs}`);
  if (condRet)
    partes.push(Prisma.sql`
      SELECT 'R' AS clase, vi."id", ve."retiradaAt" AS fecha
      FROM "VentaItem" vi
      JOIN "Venta" ve ON ve."id" = vi."ventaId"
      JOIN "Variante" v ON v."id" = vi."varianteId"
      JOIN "Producto" p ON p."id" = v."productoId"
      WHERE ${condRet}`);
  if (partes.length === 0) return { movimientos: [], total: 0, page, pageSize };

  const pagina = paginaSqlSchema.parse(
    await db.$queryRaw`
      SELECT clase, id, COUNT(*) OVER () AS total
      FROM (${Prisma.join(partes, " UNION ALL ")}) u
      ORDER BY fecha DESC, id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
  );
  const total =
    pagina[0]?.total ??
    // Página vacía más allá del final: contar igual (para paginar).
    paginaSqlSchema
      .parse(
        await db.$queryRaw`
          SELECT 'M' AS clase, '' AS id, COUNT(*) AS total
          FROM (${Prisma.join(partes, " UNION ALL ")}) u`,
      )
      .at(0)?.total ??
    0;

  const idsMov = pagina.filter((f) => f.clase === "M").map((f) => f.id);
  const idsRet = pagina.filter((f) => f.clase === "R").map((f) => f.id);
  const selectVariante = {
    select: {
      nombre: true,
      sku: true,
      productoId: true,
      producto: { select: { nombreCompleto: true } },
    },
  } as const;
  const [filas, retiros] = await Promise.all([
    idsMov.length
      ? db.movimientoStock.findMany({
          where: { id: { in: idsMov } },
          include: {
            variante: selectVariante,
            deposito: { select: { nombre: true } },
            usuario: { select: { nombre: true } },
          },
        })
      : Promise.resolve([]),
    idsRet.length
      ? db.ventaItem.findMany({
          where: { id: { in: idsRet } },
          select: {
            id: true,
            cantidad: true,
            varianteId: true,
            variante: selectVariante,
            venta: {
              select: {
                id: true,
                retiradaAt: true,
                depositoId: true,
                deposito: { select: { nombre: true } },
                retiradaPor: { select: { nombre: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);
  const refs = await resolverReferencias(ctx, [
    ...filas,
    ...retiros.map((r) => ({ referenciaTipo: "VENTA", referenciaId: r.venta.id })),
  ]);
  const porId = new Map<string, MovimientoListado>();
  for (const m of filas) {
    const referencia =
      m.referenciaTipo && m.referenciaId
        ? (refs.get(`${m.referenciaTipo}:${m.referenciaId}`) ?? null)
        : null;
    porId.set(`M:${m.id}`, {
      id: m.id,
      evento: "MOVIMIENTO",
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
      referencia,
      descripcion: describirMovimiento(m.tipo, referencia),
    });
  }
  for (const r of retiros) {
    const referencia = refs.get(`VENTA:${r.venta.id}`) ?? null;
    porId.set(`R:${r.id}`, {
      id: `retiro-${r.id}`,
      evento: "RETIRO",
      fecha: r.venta.retiradaAt!,
      tipo: TipoMovimiento.VENTA,
      cantidad: r.cantidad,
      stockAnterior: 0,
      stockPosterior: 0,
      varianteId: r.varianteId,
      productoId: r.variante.productoId,
      nombre: nombreConSabor(r.variante.producto.nombreCompleto, r.variante.nombre),
      sku: r.variante.sku,
      depositoId: r.venta.depositoId,
      deposito: r.venta.deposito.nombre,
      usuario: r.venta.retiradaPor?.nombre ?? "",
      costoUnitario: null,
      motivo: null,
      referencia,
      descripcion: describirMovimiento(TipoMovimiento.VENTA, referencia, "RETIRO"),
    });
  }
  return {
    movimientos: pagina.flatMap((f) => porId.get(`${f.clase}:${f.id}`) ?? []),
    total,
    page,
    pageSize,
  };
}
