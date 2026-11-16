import { OrigenCostoVariante, Prisma } from "@prisma/client";

import type { Tx } from "@/server/db/panel-scoped";

/**
 * ÚNICO punto que cambia `Variante.ultimoCostoUsdt` (el costo EN USDT que toma cada venta
 * como snapshot): actualiza el sabor y deja la fila en CostoVarianteHistorial
 * (inmutable) con de dónde salió el cambio. Si el costo no cambia, no hace nada.
 * Las ventas ya hechas no se tocan: conservan su VentaItem.costoUnitarioUsdt.
 * El historial también queda en USDT.
 */
export async function actualizarUltimoCosto(
  tx: Tx,
  cambio: {
    varianteId: string;
    anterior: Prisma.Decimal | null;
    nuevo: Prisma.Decimal | string | number;
    origen: OrigenCostoVariante;
    compraId?: string | null;
    usuarioId: string;
  },
): Promise<boolean> {
  const nuevo = new Prisma.Decimal(cambio.nuevo).toDecimalPlaces(2);
  if (cambio.anterior !== null && cambio.anterior.equals(nuevo)) return false;
  await tx.variante.update({ where: { id: cambio.varianteId }, data: { ultimoCostoUsdt: nuevo } });
  await tx.costoVarianteHistorial.create({
    data: {
      varianteId: cambio.varianteId,
      costoAnterior: cambio.anterior,
      costoNuevo: nuevo,
      origen: cambio.origen,
      compraId: cambio.compraId ?? null,
      usuarioId: cambio.usuarioId,
    },
  });
  return true;
}
