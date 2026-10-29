import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  filtroCarteraDe,
  ListaCartera,
  TarjetasCartera,
} from "@/components/clientes/lista-cartera";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { hrefCon } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { rutaPanel } from "@/lib/paneles";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { dbPara } from "@/server/db/panel-scoped";
import { listarCartera, resumenCartera } from "@/server/services/cartera-clientes.service";

export const metadata: Metadata = { title: "Cartera del vendedor" };

type SP = Record<string, string | string[] | undefined>;

/**
 * Cartera de clientes de un vendedor (solo dueños): los que ya tenía y los
 * nuevos que sumó con cada venta (con el link a esa venta), para controlar
 * la ganancia por cliente nuevo al pagarle.
 */
export default async function CarteraVendedorPage({
  params,
  searchParams,
}: {
  params: Promise<{ usuarioId: string }>;
  searchParams: Promise<SP>;
}) {
  const ctx = await requirePaginaPanelOwner();
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  const [{ usuarioId }, sp] = await Promise.all([params, searchParams]);
  const usuario = await dbPara(ctx.panelId).usuario.findFirst({
    where: { id: usuarioId, deletedAt: null },
    select: { id: true, nombre: true },
  });
  if (!usuario) notFound();
  const plano = Object.fromEntries(
    Object.entries(sp).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtro = filtroCarteraDe(plano.filtro);
  const PATH = ruta(`/equipo/${usuario.id}/clientes`);
  const [resumen, resultado] = await Promise.all([
    resumenCartera(ctx, usuario.id),
    listarCartera(ctx, usuario.id, {
      q: plano.q,
      filtro,
      page: Math.max(1, Number(plano.page) || 1),
    }),
  ]);

  return (
    <div className="flex flex-col">
      <header className="mb-4 flex flex-col gap-2 md:mb-6">
        <Breadcrumb
          items={[
            { label: "Equipo", href: ruta("/equipo") },
            { label: usuario.nombre, href: ruta(`/equipo/${usuario.id}`) },
            { label: "Cartera" },
          ]}
        />
        <h1 className="text-h1 font-semibold">Cartera de {usuario.nombre}</h1>
        <p className="text-muted text-small max-w-2xl">
          «Ya lo tenía»: cargado por {usuario.nombre} antes de venderle, no cuenta como cliente
          nuevo. «Nuevo»: se dio de alta con esa venta (tocala para verla) y cuenta como cliente
          nuevo en su ganancia.
        </p>
      </header>
      <TarjetasCartera
        r={resumen}
        filtro={filtro}
        hrefFiltro={(f) => hrefCon(PATH, plano, { filtro: f === "todos" ? null : f, page: null })}
      />
      <section aria-label="Buscar en la cartera" className="bg-card rounded-card mb-4 p-4">
        <SearchInput placeholder="Nombre o teléfono" />
      </section>
      <ListaCartera
        resultado={resultado}
        params={plano}
        pathname={PATH}
        hrefCliente={(id) => ruta(`/clientes/${id}`)}
        hrefVenta={(id) => ruta(`/ventas/${id}`)}
        vacio={
          <EmptyState
            title={`${usuario.nombre} todavía no tiene clientes en su cartera`}
            description="Los carga en «Mis clientes» y se suman solos los nuevos de cada venta."
          />
        }
      />
    </div>
  );
}
