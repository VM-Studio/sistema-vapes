import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPanel } from "@/server/auth/permissions";
import { obtenerCotizacion } from "@/server/services/cambio.service";
import { listar, veCostosCompras } from "@/server/services/proveedor.service";

import { ProveedoresView } from "./proveedores-view";

export const metadata: Metadata = { title: "Proveedores" };

type SP = Record<string, string | string[] | undefined>;

export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.PROVEEDORES, "ver");
  const { q } = await searchParams;
  const buscado = typeof q === "string" ? q.trim() : "";
  const verPrecios = veCostosCompras(ctx);
  const [proveedores, cotizacionUsdt] = await Promise.all([
    listar(ctx, { q: buscado || undefined }),
    verPrecios ? obtenerCotizacion("USDT") : null,
  ]);
  return (
    <ProveedoresView
      proveedores={proveedores}
      verPrecios={verPrecios}
      buscado={buscado}
      cotizacionUsdt={cotizacionUsdt}
    />
  );
}
