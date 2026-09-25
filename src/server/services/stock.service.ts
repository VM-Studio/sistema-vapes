import { Prisma, TipoMovimiento, type MovimientoStock } from "@prisma/client";

import type { Tx } from "@/lib/db";
import { ahora } from "@/lib/reloj";
import { DomainError, NotFoundError, StockInsuficienteError } from "@/server/errors";

/**
 * MOTOR DE STOCK
 *
 * Única puerta de entrada para modificar stock. Garantías:
 * - Siempre dentro de una transacción (recibe `tx`; usar withTransaction()).
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
      "El motor de stock solo puede usarse dentro de una transacción (withTransaction).",
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
 */
export async function bloquearStock(
  tx: Tx,
  varianteId: string,
  depositoIds: string[],
): Promise<Map<string, FilaStockBloqueada>> {
  const ids = [...new Set(depositoIds)].sort();

  const seleccionarParaActualizar = () => tx.$queryRaw<FilaStockBloqueada[]>`
    SELECT "id", "depositoId", "cantidad"
    FROM "Stock"
    WHERE "varianteId" = ${varianteId}
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
    await tx.stock.createMany({
      data: ids.map((depositoId) => ({ varianteId, depositoId, cantidad: 0 })),
      skipDuplicates: true,
    });
    filas = await seleccionarParaActualizar();
  }

  return new Map(filas.map((f) => [f.depositoId, f]));
}

async function describir(tx: Tx, varianteId: string, depositoId: string) {
  const [variante, deposito] = await Promise.all([
    tx.variante.findUnique({
      where: { id: varianteId },
      select: { nombre: true, producto: { select: { nombre: true, tieneVariantes: true } } },
    }),
    tx.deposito.findUnique({ where: { id: depositoId }, select: { nombre: true, activo: true } }),
  ]);
  if (!variante) throw new NotFoundError(`No existe la variante ${varianteId}.`);
  if (!deposito) throw new NotFoundError(`No existe el depósito ${depositoId}.`);

  const nombreVariante = variante.producto.tieneVariantes
    ? `${variante.producto.nombre} - ${variante.nombre}`
    : variante.producto.nombre;
  return { nombreVariante, nombreDeposito: deposito.nombre };
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

  const { nombreVariante, nombreDeposito } = await describir(
    tx,
    input.varianteId,
    input.depositoId,
  );

  const filas = await bloquearStock(tx, input.varianteId, [input.depositoId]);
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
  await bloquearStock(tx, input.varianteId, [input.depositoOrigenId, input.depositoDestinoId]);

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

/** Stock total de una variante sumando todos los depósitos (fn_stock_por_variante). */
export async function stockTotalVariante(tx: Tx, varianteId: string): Promise<number> {
  const [fila] = await tx.$queryRaw<{ total: number }[]>`
    SELECT fn_stock_por_variante(${varianteId}) AS total
  `;
  return fila?.total ?? 0;
}
