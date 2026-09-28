import { Modulo } from "@prisma/client";
import { ArrowLeft, MessageCircle, Plus, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatearPesos } from "@/lib/format";
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

  return (
    <>
      <PageHeader
        title={p.nombre}
        subtitle={
          <span className="flex items-center gap-2">
            {p.nombreTienda}
            {!p.activo && <Badge variant="neutral">Inactivo</Badge>}
          </span>
        }
        actions={
          <>
            <Link href={ruta("/proveedores")} className={buttonVariants({ variant: "secondary" })}>
              <ArrowLeft strokeWidth={1.75} /> Proveedores
            </Link>
            {p.activo && puede(usuario, panelId, Modulo.COMPRAS, "crear") && (
              <Link href={ruta(`/compras/nueva?proveedor=${p.id}`)} className={buttonVariants()}>
                <Plus strokeWidth={1.75} /> Nueva compra a este proveedor
              </Link>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <p className="text-muted">Teléfono</p>
              {p.telefono ? (
                <a
                  href={enlaceWhatsApp(p.telefono)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex min-h-11 items-center gap-1.5 font-medium"
                >
                  <MessageCircle className="size-4" strokeWidth={1.75} aria-hidden />
                  {formatearTelefono(p.telefono)}
                </a>
              ) : (
                <p>—</p>
              )}
            </div>
            <div>
              <p className="text-muted">Compras</p>
              <p className="tabular-nums">{d.cantidadCompras}</p>
            </div>
            {d.totalComprado !== null && (
              <div>
                <p className="text-muted">Total comprado</p>
                <p className="font-semibold tabular-nums">{formatearPesos(d.totalComprado)}</p>
              </div>
            )}
            {p.notas && (
              <div className="col-span-2 md:col-span-4">
                <p className="text-muted">Notas</p>
                <p className="whitespace-pre-line">{p.notas}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <ProductosProveedor
          proveedorId={p.id}
          productos={d.productos}
          verPrecios={verPrecios}
          puedeEditar={puede(usuario, panelId, Modulo.PROVEEDORES, "editar")}
        />

        <section aria-labelledby="historial" className="flex flex-col gap-3">
          <h2 id="historial" className="text-lg font-semibold">
            Historial de compras
            {d.compras.length === 50 && (
              <span className="text-muted ml-2 text-sm font-normal">(últimas 50)</span>
            )}
          </h2>
          <DataTable
            caption="Compras del proveedor"
            rows={d.compras}
            getRowKey={(c) => c.id}
            empty={<EmptyState icon={Truck} title="Todavía no hay compras a este proveedor" />}
            columns={[
              {
                key: "numero",
                header: "ID",
                cell: (c) =>
                  verCompras ? (
                    <Link
                      href={ruta(`/compras/${c.id}`)}
                      className="text-primary font-semibold hover:underline"
                    >
                      {formatearIdCompra(panel.slug, c.numero)}
                    </Link>
                  ) : (
                    <span className="font-semibold">{formatearIdCompra(panel.slug, c.numero)}</span>
                  ),
              },
              {
                key: "fecha",
                header: "Fecha",
                cell: (c) => <span className="text-muted">{formatearFechaHora(c.fecha)}</span>,
              },
              { key: "deposito", header: "Galpón", cell: (c) => c.deposito },
              {
                key: "unidades",
                header: "Unidades",
                className: "text-right tabular-nums",
                cell: (c) => c.unidades,
              },
              ...(verPrecios
                ? [
                    {
                      key: "total",
                      header: "Total",
                      className: "text-right tabular-nums",
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
              <div className="border-border bg-surface rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-2">
                  {verCompras ? (
                    <Link href={ruta(`/compras/${c.id}`)} className="text-primary font-semibold">
                      {formatearIdCompra(panel.slug, c.numero)}
                    </Link>
                  ) : (
                    <span className="font-semibold">{formatearIdCompra(panel.slug, c.numero)}</span>
                  )}
                  <Badge variant={ESTADO_COMPRA_UI[c.estado].variante}>
                    {ESTADO_COMPRA_UI[c.estado].label}
                  </Badge>
                </div>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <p className="text-muted text-xs">
                    {c.deposito} · {c.unidades} u. · {formatearFechaHora(c.fecha)}
                  </p>
                  {c.total !== null && (
                    <p className="font-semibold tabular-nums">{formatearPesos(c.total)}</p>
                  )}
                </div>
              </div>
            )}
          />
        </section>

        <AccionesProveedor
          proveedor={p}
          verPrecios={verPrecios}
          puedeEditar={puede(usuario, panelId, Modulo.PROVEEDORES, "editar")}
          puedeEliminar={puede(usuario, panelId, Modulo.PROVEEDORES, "eliminar")}
        />
      </div>
    </>
  );
}
