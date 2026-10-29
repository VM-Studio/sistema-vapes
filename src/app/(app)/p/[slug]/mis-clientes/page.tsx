import { Modulo } from "@prisma/client";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

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
import { esOwner, puede, tieneCarteraClientes } from "@/lib/permisos";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";
import { listarCartera, resumenCartera } from "@/server/services/cartera-clientes.service";

import { AccionesCartera } from "./acciones-cartera";

export const metadata: Metadata = { title: "Mis clientes" };

type SP = Record<string, string | string[] | undefined>;

/**
 * «Mis clientes»: la cartera del vendedor. Antes de vender con el sistema,
 * carga los clientes que YA tenía (no cuentan como nuevos para su ganancia);
 * los que da de alta al vender («Cliente nuevo») se suman solos, con la
 * venta que los trajo. Los dueños ven la cartera de cada uno en Equipo.
 */
export default async function MisClientesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanelUsuario();
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  if (!tieneCarteraClientes(ctx.usuario, ctx.panelId))
    redirect(esOwner(ctx.usuario) ? ruta("/equipo") : ruta("/"));
  const params = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtro = filtroCarteraDe(params.filtro);
  const PATH = ruta("/mis-clientes");
  const [resumen, resultado] = await Promise.all([
    resumenCartera(ctx, ctx.usuarioId),
    listarCartera(ctx, ctx.usuarioId, {
      q: params.q,
      filtro,
      page: Math.max(1, Number(params.page) || 1),
    }),
  ]);
  const verVentas = puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "ver");

  return (
    <div className="flex flex-col">
      <header className="mb-4 flex flex-col gap-4 md:mb-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <Breadcrumb items={[{ label: "Inicio", href: ruta("/") }, { label: "Mis clientes" }]} />
          <h1 className="text-h1 font-semibold">Mis clientes</h1>
          <p className="text-muted text-small max-w-2xl">
            Cargá acá los clientes que ya tenías antes de empezar a vender con el sistema: quedan en
            tu cartera y venderles <strong>no</strong> cuenta como cliente nuevo. Los que des de
            alta al vender con «Cliente nuevo» se suman solos, con la venta que los trajo.
          </p>
        </div>
        <AccionesCartera />
      </header>
      <TarjetasCartera
        r={resumen}
        filtro={filtro}
        hrefFiltro={(f) => hrefCon(PATH, params, { filtro: f === "todos" ? null : f, page: null })}
      />
      <section aria-label="Buscar en la cartera" className="bg-card rounded-card mb-4 p-4">
        <SearchInput placeholder="Nombre o teléfono" />
      </section>
      <ListaCartera
        resultado={resultado}
        params={params}
        pathname={PATH}
        hrefCliente={(id) => ruta(`/mis-clientes/${id}`)}
        hrefVenta={verVentas ? (id) => ruta(`/ventas/${id}`) : null}
        vacio={
          <EmptyState
            title="Tu cartera está vacía"
            description="Empezá cargando los clientes que ya tenés: uno por uno o pegando la lista entera con «Cargar varios»."
          />
        }
      />
      <div className="h-[4.5rem] md:hidden" aria-hidden />
    </div>
  );
}
