// Sin "server-only": lo importa el middleware (runtime Node, sin la condición react-server).
import { prisma } from "@/lib/db";

/**
 * Paneles activos, cacheados 60 s en memoria (compartido entre el middleware
 * y las acciones vía globalThis, igual que las sesiones). Crear, editar o
 * desactivar un panel invalida el caché de esta instancia al instante.
 */

import type { PanelBasico } from "@/lib/paneles";

export type { PanelBasico };

const TTL_MS = 60_000;
type Cache = { t: number; paneles: PanelBasico[] };
const global = globalThis as unknown as { __cachePaneles?: Cache | null };

export async function panelesActivos(): Promise<PanelBasico[]> {
  const c = global.__cachePaneles;
  if (c && Date.now() - c.t < TTL_MS) return c.paneles;
  const paneles = await prisma.panel.findMany({
    where: { activo: true },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: {
      id: true,
      nombre: true,
      slug: true,
      logoUrl: true,
      colorAcento: true,
      etiquetaEspecificacion: true,
      etiquetaUnidades: true,
      orden: true,
    },
  });
  global.__cachePaneles = { t: Date.now(), paneles };
  return paneles;
}

/** Panel activo por slug; null si no existe o está desactivado. */
export async function panelPorSlug(slug: string): Promise<PanelBasico | null> {
  return (await panelesActivos()).find((p) => p.slug === slug) ?? null;
}

export function invalidarCachePaneles(): void {
  global.__cachePaneles = null;
}

/** /p/{slug}/... y /api/p/{slug}/... → slug. */
export function slugDeRuta(pathname: string): string | null {
  return pathname.match(/^\/(?:api\/)?p\/([a-z0-9-]+)(?:\/|$)/)?.[1] ?? null;
}
