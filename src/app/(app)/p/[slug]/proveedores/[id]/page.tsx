import { Modulo } from "@prisma/client";
import { MessageCircle, Plus, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { ESTADO_COMPRA_UI } from "@/lib/movimientos-ui";
import { formatearIdCompra, rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { enlaceWhatsApp, formatearTelefono } from "@/lib/validations/proveedor";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtener, veCostosCompras } from "@/server/services/proveedor.service";

import { AccionesProveedor } from "./acciones-proveedor";
import { ProductosProveedor } from "./productos-proveedor";

export const metadata: Metadata = { title: "Proveedor" };

export default async function ProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.PROVEEDORES, "ver");
  const { usuario, panelId, panel } = ctx;
  const ruta = (r: string) => rutaPanel(panel.slug, r);
  const { id } = await params;
  const d = await obtener(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const p = d.proveedor;
  const verPrecios = veCostosCompras(ctx);
  const verCompras = puede(usuario, panelId, Modulo.COMPRAS, "ver");

  const puedeNuevaCompra = p.activo && puede(usuario, panelId, Modulo.COMPRAS, "crear");
  const nuevaCompra = (
    <Link href={ruta(`/compras/nueva?proveedor=${p.id}`)} className={buttonVariants()}>
      <Plus strokeWidth={1.75} /> Nueva compra a este proveedor
    </Link>
  );
  const idCompra = (c: (typeof d.compras)[number]) =>
    verCompras ? (
      <Link
        href={ruta(`/compras/${c.id}`)}
        className="font-mono font-semibold underline-offset-4 hover:underline"
      >
        {formatearIdCompra(panel.slug, c.numero)}
      </Link>
    ) : (
      <span className="font-mono font-semibold">{formatearIdCompra(panel.slug, c.numero)}</span>
    );

  return (
    <>
      <PageHeader
        title={p.nombre}
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Proveedores", href: ruta("/proveedores") }, { label: p.nombre }]}
          />
        }
        subtitle={
          <span className="flex items-center gap-2">
            {p.nombreTienda}
            {!p.activo && <Badge variant="neutral">Inactivo</Badge>}
          </span>
        }
        actions={
          <>
            <AccionesProveedor
              proveedor={p}
              verPrecios={verPrecios}
              puedeEditar={puede(usuario, panelId, Modulo.PROVEEDORES, "editar")}
              puedeEliminar={puede(usuario, panelId, Modulo.PROVEEDORES, "eliminar")}
            />
            {puedeNuevaCompra && <div className="hidden md:flex">{nuevaCompra}</div>}
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="col-span-2 flex flex-col gap-4 p-5">
            <h2 className="text-h3 font-semibold">Contacto</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-muted text-small">Teléfono</dt>
                <dd className="flex flex-wrap items-center gap-3">
                  {p.telefono ? (
                    <>
                      <span className="tabular-nums">{formatearTelefono(p.telefono)}</span>
                      <a
                        href={enlaceWhatsApp(p.telefono)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`WhatsApp a ${p.nombre}`}
                        className={buttonVariants({
                          variant: "secondary",
                          size: "sm",
                          className: "max-md:h-11",
                        })}
                      >
                        <MessageCircle strokeWidth={1.75} /> WhatsApp
                      </a>
                    </>
                  ) : (
                    <span className="text-subtle">Sin teléfono</span>
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted text-small">Tienda</dt>
                <dd>{p.nombreTienda}</dd>
              </div>
              {p.notas && (
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <dt className="text-muted text-small">Notas</dt>
                  <dd className="whitespace-pre-line">{p.notas}</dd>
                </div>
              )}
            </dl>
          </Card>
          <StatCard
            label="Compras"
            value={formatearNumero(d.cantidadCompras)}
            className={d.totalComprado === null ? "col-span-2" : undefined}
          />
          {d.totalComprado !== null && (
            <StatCard label="Total comprado" value={formatearPesos(d.totalComprado)} />
          )}
        </div>

        <ProductosProveedor
          proveedorId={p.id}
          productos={d.productos}
          verPrecios={verPrecios}
          puedeEditar={puede(usuario, panelId, Modulo.PROVEEDORES, "editar")}
        />

        <SectionCard
          title="Historial de compras"
          description={d.compras.length === 50 ? "Últimas 50 compras" : undefined}
        >
          <DataTable
            caption="Compras del proveedor"
            rows={d.compras}
            getRowKey={(c) => c.id}
            empty={
              <EmptyState
                icon={Truck}
                title="Todavía no hay compras a este proveedor"
                className="bg-surface"
              />
            }
            columns={[
              { key: "numero", header: "ID", cell: idCompra },
              {
                key: "fecha",
                header: "Fecha",
                cell: (c) => <span className="text-muted">{formatearFechaHora(c.fecha)}</span>,
              },
              { key: "deposito", header: "Galpón", cell: (c) => c.deposito },
              {
                key: "unidades",
                header: "Unidades",
                className: "text-right",
                cell: (c) => formatearNumero(c.unidades),
              },
              ...(verPrecios
                ? [
                    {
                      key: "total",
                      header: "Total",
                      className: "text-right font-medium",
                      cell: (c: (typeof d.compras)[number]) => formatearPesos(c.total),
                    },
                  ]
                : []),
              {
                key: "estado",
                header: "Estado",
                cell: (c) => (
                  <Badge variant={ESTADO_COMPRA_UI[c.estado].variante}>
                    {ESTADO_COMPRA_UI[c.estado].label}
                  </Badge>
                ),
              },
            ]}
            renderMobile={(c) => (
              <div className="border-border bg-surface rounded-card flex flex-col gap-1.5 border p-4">
                <div className="flex items-center justify-between gap-2">
                  {idCompra(c)}
                  <Badge variant={ESTADO_COMPRA_UI[c.estado].variante}>
                    {ESTADO_COMPRA_UI[c.estado].label}
                  </Badge>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <p className="text-muted text-small">
                    {c.deposito} · {c.unidades} u. · {formatearFechaHora(c.fecha)}
                  </p>
                  {c.total !== null && (
                    <p className="font-semibold tabular-nums">{formatearPesos(c.total)}</p>
                  )}
                </div>
              </div>
            )}
          />
        </SectionCard>
      </div>
      {puedeNuevaCompra && <BarraAccion soloMobile>{nuevaCompra}</BarraAccion>}
    </>
  );
}
