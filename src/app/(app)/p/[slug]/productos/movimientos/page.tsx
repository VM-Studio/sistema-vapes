import type { Metadata } from "next";

import { PaginaMovimientos, type SP } from "../../stock/movimientos/pagina-movimientos";

export const metadata: Metadata = { title: "Movimientos de stock" };

/** El mismo ledger que Stock → Movimientos, desde el módulo Productos. */
export default function MovimientosProductosPage({ searchParams }: { searchParams: Promise<SP> }) {
  return <PaginaMovimientos searchParams={searchParams} seccion="productos" />;
}
