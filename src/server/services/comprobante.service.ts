import type { TipoComprobante } from "@prisma/client";

import type { Tx } from "@/lib/db";

/**
 * Reserva el próximo número de comprobante para (tipo, puntoVenta).
 *
 * SELECT ... FOR UPDATE sobre la fila de SecuenciaComprobante: dos ventas
 * simultáneas nunca obtienen el mismo número, y si la transacción que lo pidió
 * hace rollback, el número no se consume (la numeración queda sin huecos).
 * Debe llamarse en la MISMA transacción que inserta el Comprobante; la DB
 * rechaza números que no hayan salido de la secuencia.
 */
export async function siguienteNumeroComprobante(
  tx: Tx,
  tipo: TipoComprobante,
  puntoVenta = 1,
): Promise<number> {
  const bloquear = () => tx.$queryRaw<{ id: string; ultimoNumero: number }[]>`
    SELECT "id", "ultimoNumero"
    FROM "SecuenciaComprobante"
    WHERE "tipo" = ${tipo}::"TipoComprobante" AND "puntoVenta" = ${puntoVenta}
    FOR UPDATE
  `;

  let [secuencia] = await bloquear();
  if (!secuencia) {
    // Punto de venta nuevo: crear la secuencia (tolera creación concurrente).
    await tx.secuenciaComprobante.createMany({
      data: [{ tipo, puntoVenta, ultimoNumero: 0 }],
      skipDuplicates: true,
    });
    [secuencia] = await bloquear();
  }
  if (!secuencia) throw new Error(`No se pudo obtener la secuencia de ${tipo} PV ${puntoVenta}.`);

  const actualizada = await tx.secuenciaComprobante.update({
    where: { id: secuencia.id },
    data: { ultimoNumero: secuencia.ultimoNumero + 1 },
    select: { ultimoNumero: true },
  });
  return actualizada.ultimoNumero;
}
