import { Modulo } from "@prisma/client";
import { ArrowLeft, Plus, Truck } from "lucide-react";
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
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { formatearCuit } from "@/lib/validations/proveedor";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerProveedor } from "@/server/services/proveedor.service";

import { AccionesProveedor } from "./acciones-proveedor";

export const metadata: Metadata = { title: "Proveedor" };

export default async function ProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.PROVEEDORES, "ver");
  const { usuario, panelId } = ctx;
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  const { id } = await params;
  const verCompras = puede(usuario, panelId, Modulo.COMPRAS, "ver");
  const { proveedor: p, compras } = await obtenerProveedor(ctx, id, {
    conCompras: verCompras,
  }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const recibidas = (compras ?? []).filter((c) => c.estado === "RECIBIDA");
  const total = recibidas.reduce((a, c) => a + Number(c.total), 0);

  return (
    <>
      <PageHeader
        title={p.nombre}
        subtitle={p.activo ? undefined : <Badge variant="neutral">Inactivo</Badge>}
        actions={
          <>
            <Link href={ruta("/proveedores")} className={buttonVariants({ variant: "secondary" })}>
              <ArrowLeft /> Proveedores
            </Link>
            {p.activo && puede(usuario, panelId, Modulo.COMPRAS, "crear") && (
              <Link href={ruta(`/compras/nueva?proveedor=${p.id}`)} className={buttonVariants()}>
                <Plus /> Nueva compra
              </Link>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <p className="text-muted">CUIT</p>
              <p className="tabular-nums">{p.cuit ? formatearCuit(p.cuit) : "—"}</p>
            </div>
            <div>
              <p className="text-muted">Teléfono</p>
              <p>{p.telefono ?? "—"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-muted">Email</p>
              <p className="truncate">{p.email ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted">Dirección</p>
              <p>{p.direccion ?? "—"}</p>
            </div>
            {p.notas && (
              <div className="col-span-2 md:col-span-4">
                <p className="text-muted">Notas</p>
                <p className="whitespace-pre-line">{p.notas}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {compras && (
          <section aria-labelledby="historial" className="flex flex-col gap-3">
            <h2 id="historial" className="text-lg font-semibold">
              Historial de compras
              <span className="text-muted ml-2 text-sm font-normal">
                {recibidas.length} recibidas · {formatearPesos(total)}
                {compras.length === 50 && " (últimas 50)"}
              </span>
            </h2>
            <DataTable
              caption="Compras del proveedor"
              rows={compras}
              getRowKey={(c) => c.id}
              empty={<EmptyState icon={Truck} title="Todavía no hay compras a este proveedor" />}
              columns={[
                {
                  key: "numero",
                  header: "N.º",
                  cell: (c) => (
                    <Link
                      href={ruta(`/compras/${c.id}`)}
                      className="text-primary font-semibold hover:underline"
                    >
                      #{c.numero}
                    </Link>
                  ),
                },
                {
                  key: "fecha",
                  header: "Fecha",
                  cell: (c) => <span className="text-muted">{formatearFechaHora(c.fecha)}</span>,
                },
                { key: "deposito", header: "Depósito", cell: (c) => c.deposito },
                {
                  key: "unidades",
                  header: "Unidades",
                  className: "text-right tabular-nums",
                  cell: (c) => c.unidades,
                },
                {
                  key: "total",
                  header: "Total",
                  className: "text-right tabular-nums",
                  cell: (c) => formatearPesos(c.total),
                },
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
                <Link
                  href={ruta(`/compras/${c.id}`)}
                  className="border-border bg-surface block rounded-2xl border p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">#{c.numero}</span>
                    <Badge variant={ESTADO_COMPRA_UI[c.estado].variante}>
                      {ESTADO_COMPRA_UI[c.estado].label}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <p className="text-muted text-xs">
                      {c.deposito} · {c.unidades} u. · {formatearFechaHora(c.fecha)}
                    </p>
                    <p className="font-semibold tabular-nums">{formatearPesos(c.total)}</p>
                  </div>
                </Link>
              )}
            />
          </section>
        )}

        <AccionesProveedor
          proveedor={p}
          puedeEditar={puede(usuario, panelId, Modulo.PROVEEDORES, "editar")}
          puedeEliminar={puede(usuario, panelId, Modulo.PROVEEDORES, "eliminar")}
        />
      </div>
    </>
  );
}
