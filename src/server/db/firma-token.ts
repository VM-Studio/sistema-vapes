import { prisma } from "@/lib/db";

/**
 * Link público de firma (/firma/{token}): el token llega SIN sesión ni panel,
 * así que la única búsqueda global es esta (por el hash, que es único). Con
 * el panel resuelto, todo lo demás va por dbPara(panelId).
 */
export async function liquidacionPorTokenHash(
  hash: string,
): Promise<{ id: string; panelId: string } | null> {
  return prisma.liquidacionVendedor.findUnique({
    where: { firmaTokenHash: hash },
    select: { id: true, panelId: true },
  });
}
