import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Singleton de PrismaClient.
 * En dev, Next recarga módulos en caliente: guardamos la instancia en globalThis
 * para no abrir un pool de conexiones nuevo en cada recarga.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function crearCliente(): PrismaClient {
  // PRISMA_LOG=silent: scripts que provocan errores a propósito (tests).
  // PRISMA_LOG=query: emite cada SQL como evento ($on("query")) para inspeccionarlo.
  const modo = process.env.PRISMA_LOG;
  if (modo === "query") {
    return new PrismaClient({
      log: [{ emit: "event", level: "query" }],
    }) as unknown as PrismaClient;
  }
  return new PrismaClient({
    log:
      modo === "silent"
        ? []
        : process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? crearCliente();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;

export interface TransactionOptions {
  /** Default: Serializable (lo que exige todo lo que mueve stock). */
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Reintentos ante conflicto de serialización/deadlock. Default: 1. */
  maxRetries?: number;
  /** ms máximos esperando una conexión del pool. */
  maxWait?: number;
  /** ms máximos de la transacción completa. */
  timeout?: number;
}

/**
 * ¿El error es un conflicto de concurrencia que se resuelve reintentando?
 * - P2034: "Transaction failed due to a write conflict or a deadlock".
 * - 40001 / 40P01 pueden llegar crudos desde $queryRaw/$executeRaw (P2010).
 */
export function esErrorReintentable(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code === "P2010") {
    const meta = error.meta as { code?: string } | undefined;
    return meta?.code === "40001" || meta?.code === "40P01";
  }
  return false;
}

/**
 * Ejecuta `fn` en una transacción interactiva con isolation level explícito
 * (Serializable por defecto) y la reintenta ante conflictos de serialización.
 * Toda operación que mueve stock DEBE pasar por acá.
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const {
    isolationLevel = Prisma.TransactionIsolationLevel.Serializable,
    maxRetries = 1,
    maxWait = 5_000,
    timeout = 15_000,
  } = options;

  for (let intento = 0; ; intento++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel, maxWait, timeout });
    } catch (error) {
      if (intento < maxRetries && esErrorReintentable(error)) {
        // Pequeño jitter para que las transacciones en conflicto no choquen de nuevo.
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Usa la transacción que recibe (si la hay) o abre una propia. Para servicios
 * que a veces se componen dentro de otra operación atómica (ej. /api/sync:
 * registrar la operación offline y aplicarla en la MISMA transacción).
 */
export function enTransaccion<T>(
  tx: Tx | undefined,
  fn: (tx: Tx) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return tx ? fn(tx) : withTransaction(fn, options);
}
