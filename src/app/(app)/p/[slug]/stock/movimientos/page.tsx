import type { Metadata } from "next";

import { PaginaMovimientos, type SP } from "./pagina-movimientos";

export const metadata: Metadata = { title: "Movimientos de stock" };

/** Ledger del panel desde Stock: Global (todos los depósitos) o un depósito. */
export default function MovimientosPage({ searchParams }: { searchParams: Promise<SP> }) {
  return <PaginaMovimientos searchParams={searchParams} seccion="stock" />;
}
