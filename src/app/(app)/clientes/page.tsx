import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { esOwner } from "@/lib/permisos";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarClientes } from "@/server/services/cliente.service";

import { ClientesView } from "./clientes-view";

export const metadata: Metadata = { title: "Clientes" };

type SP = Record<string, string | string[] | undefined>;

export default async function ClientesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const usuario = await requirePaginaPermiso(Modulo.CLIENTES, "ver");
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const r = await listarClientes({
    q: plano.q,
    conDeuda: plano.conDeuda === "1",
    page: Math.max(1, Number(plano.page) || 1),
    pageSize: 30,
  });
  return <ClientesView resultado={r} params={plano} puedeDefinirLimite={esOwner(usuario)} />;
}
