import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarProveedores } from "@/server/services/proveedor.service";

import { ProveedoresView } from "./proveedores-view";

export const metadata: Metadata = { title: "Proveedores" };

type SP = Record<string, string | string[] | undefined>;

export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePaginaPermiso(Modulo.PROVEEDORES, "ver");
  const { q } = await searchParams;
  const proveedores = await listarProveedores(typeof q === "string" ? q.trim() : undefined);
  return <ProveedoresView proveedores={proveedores} />;
}
