import type { Tx } from "@/lib/db";

export type EntidadNumerada = "VENTA" | "COMPRA" | "TRANSFERENCIA" | "DEVOLUCION";

/**
 * Próximo número correlativo de `entidad` en el panel. SELECT ... FOR UPDATE
 * sobre la fila de Secuencia: dos transacciones concurrentes del mismo panel
 * se serializan (la segunda espera o reintenta) y nunca repiten número. Un
 * trigger impide que la secuencia retroceda o se borre.
 * Siempre dentro de la transacción que inserta el documento: si esa
 * transacción falla, el número no se consume.
 */
export async function siguienteNumero(
  tx: Tx,
  panelId: string,
  entidad: EntidadNumerada,
): Promise<number> {
  const [fila] = await tx.$queryRaw<{ id: string; ultimoNumero: number }[]>`
    SELECT "id", "ultimoNumero" FROM "Secuencia"
    WHERE "panelId" = ${panelId} AND "entidad" = ${entidad}
    FOR UPDATE
  `;
  if (!fila) throw new Error(`Falta la secuencia ${entidad} del panel ${panelId}.`);
  const numero = fila.ultimoNumero + 1;
  await tx.$executeRaw`
    UPDATE "Secuencia" SET "ultimoNumero" = ${numero}, "updatedAt" = now() WHERE "id" = ${fila.id}
  `;
  return numero;
}
