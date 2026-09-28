import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { esOwner } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { clientesNuevosDelMes, listarClientes } from "@/server/services/cliente.service";

import { ClientesView } from "./clientes-view";

export const metadata: Metadata = { title: "Clientes" };

type SP = Record<string, string | string[] | undefined>;

export default async function ClientesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.CLIENTES, "ver");
  const params = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const verTotales = esOwner(ctx.usuario);
  const [r, nuevos] = await Promise.all([
    listarClientes(
      ctx,
      { q: plano.q, page: Math.max(1, Number(plano.page) || 1), pageSize: 30 },
      { verTotales },
    ),
    clientesNuevosDelMes(ctx),
  ]);
  return (
    <ClientesView resultado={r} params={plano} nuevosDelMes={nuevos} verTotales={verTotales} />
  );
}
