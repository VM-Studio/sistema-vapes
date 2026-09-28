import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarProveedores } from "@/server/services/proveedor.service";

import { ProveedoresView } from "./proveedores-view";

export const metadata: Metadata = { title: "Proveedores" };

type SP = Record<string, string | string[] | undefined>;

export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.PROVEEDORES, "ver");
  const { q } = await searchParams;
  const proveedores = await listarProveedores(ctx, {
    q: typeof q === "string" ? q.trim() : undefined,
    conCompras: puede(ctx.usuario, ctx.panelId, Modulo.COMPRAS, "ver"),
  });
  return <ProveedoresView proveedores={proveedores} />;
}
