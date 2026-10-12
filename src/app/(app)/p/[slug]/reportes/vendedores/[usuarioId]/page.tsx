import { redirect } from "next/navigation";

import { rutaPanel } from "@/lib/paneles";
import { queryPeriodo } from "@/server/services/analitica.service";

/**
 * "Ventas de {vendedor}" vive en Equipo (`/equipo/[usuarioId]`): una sola
 * pantalla para lo mismo. Esta ruta de Reportes redirige ahí, conservando el
 * período y la miga de pan de Reportes.
 */
export default async function VentasVendedorReporte({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; usuarioId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug, usuarioId }, sp] = await Promise.all([params, searchParams]);
  const qs = queryPeriodo(sp);
  redirect(rutaPanel(slug, `/equipo/${usuarioId}${qs ? `${qs}&` : "?"}origen=reportes`));
}
