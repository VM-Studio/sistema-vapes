import { EstadoCompra, Modulo } from "@prisma/client";
import { Plus, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { BarraAccion } from "@/components/ui/barra-accion";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { MenuFila } from "@/components/ui/menu-fila";
import { PageHeader } from "@/components/ui/page-header";
import { hrefCon, Pagination } from "@/components/ui/pagination";
import { formatearPesos } from "@/lib/format";
import { ESTADO_COMPRA_UI } from "@/lib/movimientos-ui";
import { formatearIdCompra, rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { listarComprasSchema } from "@/lib/validations/compra";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarCompras, type CompraListada } from "@/server/services/compra.service";
import { listarProveedoresActivos, veCostosCompras } from "@/server/services/proveedor.service";

import { FiltrosCompras } from "./filtros-compras";

export const metadata: Metadata = { title: "Compras" };

type SP = Record<string, string | string[] | undefined>;

export default async function ComprasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.COMPRAS, "ver");
  const PATH = rutaPanel(ctx.panel.slug, "/compras");
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtros = listarComprasSchema.parse(plano);
  const [r, proveedores] = await Promise.all([
    listarCompras(ctx, filtros),
    listarProveedoresActivos(ctx),
  ]);

  const verCostos = veCostosCompras(ctx);
  const puedeCrear = puede(ctx.usuario, ctx.panelId, Modulo.COMPRAS, "crear");
  const conFiltros = Object.entries(plano).some(([k, v]) => k !== "page" && v !== "");
  const idDe = (c: CompraListada) => formatearIdCompra(ctx.panel.slug, c.numero);
  const estadoBadge = (c: CompraListada) => (
    <Badge variant={ESTADO_COMPRA_UI[c.estado].variante}>{ESTADO_COMPRA_UI[c.estado].label}</Badge>
  );

  const puedeEditar = puede(ctx.usuario, ctx.panelId, Modulo.COMPRAS, "editar");
  const botonNueva = (
    <Link href={`${PATH}/nueva`} className={buttonVariants()}>
      <Plus strokeWidth={1.75} /> Nueva compra
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle="Mercadería recibida de proveedores. El stock entra al recibir la compra."
        actions={puedeCrear && <div className="hidden md:flex">{botonNueva}</div>}
      />
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <ChipRow ariaLabel="Estado" className="lg:pb-0.5">
          <ChipLink
            href={hrefCon(PATH, plano, { estado: null, page: null })}
            activo={!filtros.estado}
          >
            Todas
          </ChipLink>
          {Object.values(EstadoCompra).map((e) => (
            <ChipLink
              key={e}
              href={hrefCon(PATH, plano, { estado: e, page: null })}
              activo={filtros.estado === e}
            >
              {ESTADO_COMPRA_UI[e].label}
            </ChipLink>
          ))}
        </ChipRow>
        <FiltrosCompras params={plano} proveedores={proveedores} />
      </div>
      <DataTable
        caption="Compras"
        rows={r.compras}
        getRowKey={(c) => c.id}
        empty={
          conFiltros ? (
            <EmptyState
              icon={Truck}
              title="No hay compras con esos filtros"
              action={
                <Link href={PATH} className={buttonVariants({ variant: "secondary" })}>
                  Limpiar filtros
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Truck}
              title="Todavía no hay compras"
              description="Registrá la mercadería que llega de tus proveedores escaneándola."
              action={
                puedeCrear ? (
                  <Link href={`${PATH}/nueva`} className={buttonVariants()}>
                    <Plus strokeWidth={1.75} /> Registrar la primera compra
                  </Link>
                ) : null
              }
            />
          )
        }
        columns={[
          {
            key: "numero",
            header: "ID",
            cell: (c) => (
              <Link
                href={`${PATH}/${c.id}`}
                className="font-mono font-semibold underline-offset-4 hover:underline"
              >
                {idDe(c)}
              </Link>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (c) => (
              <span className="text-muted whitespace-nowrap">{formatearFechaHora(c.fecha)}</span>
            ),
          },
          {
            key: "proveedor",
            header: "Proveedor",
            cell: (c) => c.proveedor ?? <span className="text-subtle">—</span>,
          },
          { key: "deposito", header: "Galpón", cell: (c) => c.deposito },
          {
            key: "items",
            header: "Productos",
            className: "text-right",
            cell: (c) => (
              <span className="whitespace-nowrap">
                {c.items} <span className="text-subtle">({c.unidades} u.)</span>
              </span>
            ),
          },
          ...(verCostos
            ? [
                {
                  key: "total",
                  header: "Total",
                  className: "text-right font-medium",
                  cell: (c: CompraListada) => formatearPesos(c.total),
                },
              ]
            : []),
          { key: "estado", header: "Estado", cell: estadoBadge },
          {
            key: "acciones",
            header: <span className="sr-only">Acciones</span>,
            className: "w-12 text-right",
            ocultarEnMobile: true,
            cell: (c: CompraListada) => (
              <MenuFila
                label={`Acciones de la compra ${idDe(c)}`}
                acciones={[
                  { label: "Ver detalle", href: `${PATH}/${c.id}` },
                  ...(c.estado === "BORRADOR" && puedeEditar
                    ? [{ label: "Editar borrador", href: `${PATH}/${c.id}/editar` }]
                    : []),
                ]}
              />
            ),
          },
        ]}
        renderMobile={(c) => (
          <Link
            href={`${PATH}/${c.id}`}
            className={cardVariants({ variant: "clickable", className: "flex flex-col gap-2 p-4" })}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold">{idDe(c)}</span>
              {estadoBadge(c)}
            </div>
            <p className="truncate font-medium">{c.proveedor ?? "Sin proveedor"}</p>
            <div className="flex items-end justify-between gap-2">
              <p className="text-muted text-small">
                {c.deposito} · {c.unidades} u. · {formatearFechaHora(c.fecha)}
              </p>
              {verCostos && (
                <p className="shrink-0 font-semibold tabular-nums">{formatearPesos(c.total)}</p>
              )}
            </div>
          </Link>
        )}
      />
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname={PATH}
        params={plano}
      />
      {puedeCrear && <BarraAccion soloMobile>{botonNueva}</BarraAccion>}
    </>
  );
}
