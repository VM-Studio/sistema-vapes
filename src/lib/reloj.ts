/**
 * Hora "de negocio" de los servicios (fecha de una venta, de una compra o de
 * un movimiento de stock). En la app es siempre `new Date()`.
 *
 * Existe para que `prisma/seed-demo.ts` pueda simular 90 días de operación
 * pasando por los servicios REALES (con sus triggers)
 * en vez de insertar filas a mano. En producción no se puede fijar.
 */
let reloj: (() => Date) | null = null;

export function ahora(): Date {
  return reloj ? reloj() : new Date();
}

export function fijarReloj(fn: (() => Date) | null): void {
  if (fn && process.env.NODE_ENV === "production") {
    throw new Error("El reloj de negocio no se puede fijar en producción.");
  }
  reloj = fn;
}
