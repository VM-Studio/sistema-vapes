import { randomInt } from "node:crypto";

import type { Tx } from "@/lib/db";
import { ConflictError } from "@/server/errors";

const ALFABETO_SKU = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I: se leen mal impresos
const LARGO_SKU = 6;

async function prefijoSku(tx: Tx): Promise<string> {
  const conf = await tx.configuracion.findUnique({ where: { clave: "prefijoSku" } });
  return typeof conf?.valor === "string" && conf.valor.trim() !== "" ? conf.valor.trim() : "PRD";
}

/** Genera un SKU libre con formato `{prefijo}-XXXXXX` (prefijo configurable, default PRD). */
export async function generarSku(tx: Tx): Promise<string> {
  const prefijo = await prefijoSku(tx);
  for (let intento = 0; intento < 10; intento++) {
    const sufijo = Array.from(
      { length: LARGO_SKU },
      () => ALFABETO_SKU[randomInt(ALFABETO_SKU.length)],
    ).join("");
    const sku = `${prefijo}-${sufijo}`;
    const existe = await tx.variante.findUnique({ where: { sku }, select: { id: true } });
    if (!existe) return sku;
  }
  throw new Error("No se pudo generar un SKU único tras 10 intentos.");
}

/**
 * Verifica que un código de barras no esté usado ni como código principal de
 * una variante activa ni como código alternativo. La DB lo garantiza igual
 * (índice parcial + trigger); esto da un mensaje claro antes de llegar ahí.
 */
export async function assertCodigoBarrasDisponible(
  tx: Tx,
  codigo: string,
  opciones: { excluirVarianteId?: string } = {},
): Promise<void> {
  const [variante, alternativo] = await Promise.all([
    tx.variante.findFirst({
      where: {
        codigoBarras: codigo,
        deletedAt: null,
        ...(opciones.excluirVarianteId ? { id: { not: opciones.excluirVarianteId } } : {}),
      },
      select: { nombre: true, producto: { select: { nombre: true } } },
    }),
    tx.codigoBarrasAlternativo.findUnique({
      where: { codigo },
      select: { variante: { select: { nombre: true, producto: { select: { nombre: true } } } } },
    }),
  ]);

  const duena = variante ?? alternativo?.variante;
  if (duena) {
    throw new ConflictError(
      `El código de barras ${codigo} ya pertenece a ${duena.producto.nombre} - ${duena.nombre}.`,
    );
  }
}
