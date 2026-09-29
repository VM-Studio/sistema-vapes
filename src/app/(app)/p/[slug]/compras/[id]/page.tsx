import { Modulo } from "@prisma/client";
import { ChevronRight, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { ESTADO_COMPRA_UI } from "@/lib/movimientos-ui";
import { formatearIdCompra, rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { cn, formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerCompra, preciosQueCambian } from "@/server/services/compra.service";
import { veCostosCompras } from "@/server/services/proveedor.service";

import { AccionesCompra } from "./acciones-compra";

export const metadata: Metadata = { title: "Compra" };

export default async function CompraPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.COMPRAS, "ver");
  const { usuario, panelId, panel } = ctx;
  const ruta = (r: string) => rutaPanel(panel.slug, r);
  const { id } = await params;
  const c = await obtenerCompra(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const idVisible = formatearIdCompra(panel.slug, c.numero);
  const verCostos = veCostosCompras(ctx);
  const puedeEditar = puede(usuario, panelId, Modulo.COMPRAS, "editar");
  const cambios = c.estado === "BORRADOR" && puedeEditar ? await preciosQueCambian(ctx, c.id) : [];
  const verMovimientos = c.movimientos > 0 && puede(usuario, panelId, Modulo.STOCK, "ver");

  const verProveedor = c.proveedorId && puede(usuario, panelId, Modulo.PROVEEDORES, "ver");
  const barraMobile = c.estado === "BORRADOR" && puedeEditar;

  return (
    <>
      <PageHeader
        title={`Compra ${idVisible}`}
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Compras", href: ruta("/compras") }, { label: idVisible }]}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {c.proveedor ?? "Sin proveedor"}
            <Badge variant={ESTADO_COMPRA_UI[c.estado].variante}>
              {ESTADO_COMPRA_UI[c.estado].label}
            </Badge>
          </span>
        }
        actions={
          <AccionesCompra
            id={c.id}
            idVisible={idVisible}
            estado={c.estado}
            unidades={c.unidades}
            deposito={c.deposito}
            proveedor={c.proveedorNombre ?? "el proveedor"}
            cambios={cambios}
            puedeEditar={puedeEditar}
            puedeAnular={puede(usuario, panelId, Modulo.COMPRAS, "eliminar")}
          />
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <SectionCard
          title="Productos"
          description={`${c.items.length} ${c.items.length === 1 ? "producto" : "productos"} · ${formatearNumero(c.unidades)} unidades`}
          className="lg:col-span-2"
          contentClassName="flex flex-col gap-4"
        >
          <DataTable
            caption="Ítems"
            rows={c.items}
            getRowKey={(i) => i.varianteId}
            columns={[
              {
                key: "producto",
                header: "Producto",
                cell: (i) => (
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{i.nombreCompleto}</span>
                    <span className="text-subtle text-xs">
                      {i.sabor ? `${i.sabor} · ` : ""}
                      {i.sku}
                    </span>
                  </span>
                ),
              },
              {
                key: "cantidad",
                header: "Cantidad",
                className: "text-right",
                cell: (i) => formatearNumero(i.cantidad),
              },
              ...(verCostos
                ? [
                    {
                      key: "costo",
                      header: "Costo unitario",
                      className: "text-right",
                      cell: (i: (typeof c.items)[number]) => (
                        <span className="text-muted">{formatearPesos(i.costoUnitario)}</span>
                      ),
                    },
                    {
                      key: "subtotal",
                      header: "Subtotal",
                      className: "text-right font-medium",
                      cell: (i: (typeof c.items)[number]) => formatearPesos(i.subtotal),
                    },
                  ]
                : []),
            ]}
            renderMobile={(i) => (
              <div className="border-border bg-surface rounded-card flex items-start justify-between gap-3 border p-4">
                <div className="min-w-0">
                  <p className="font-medium">{i.nombreCompleto}</p>
                  <p className="text-muted text-small">
                    {i.sabor ? `${i.sabor} · ` : ""}
                    {i.sku} · {i.cantidad} u.
                    {verCostos && ` × ${formatearPesos(i.costoUnitario)}`}
                  </p>
                </div>
                {verCostos && (
                  <p className="shrink-0 font-semibold tabular-nums">
                    {formatearPesos(i.subtotal)}
                  </p>
                )}
              </div>
            )}
          />
          <div className="border-border flex items-baseline justify-between gap-3 border-t pt-4">
            <span className="text-h3 font-semibold">
              Total{" "}
              <span className="text-muted text-small font-normal">({c.unidades} unidades)</span>
            </span>
            {verCostos && (
              <span className="text-h2 font-semibold tabular-nums">{formatearPesos(c.total)}</span>
            )}
          </div>
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard title="Datos de la compra">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-1">
              <Dato label="Fecha">{formatearFechaHora(c.fecha)}</Dato>
              <Dato label="Galpón">{c.deposito}</Dato>
              <Dato label="Proveedor">
                {verProveedor ? (
                  <Link
                    href={ruta(`/proveedores/${c.proveedorId}`)}
                    className="font-medium underline underline-offset-4"
                  >
                    {c.proveedor}
                  </Link>
                ) : (
                  (c.proveedor ?? "—")
                )}
              </Dato>
              <Dato label="Cargada por">{c.usuario}</Dato>
              {c.notas && (
                <Dato label="Notas" className="col-span-2 lg:col-span-1">
                  <span className="whitespace-pre-line">{c.notas}</span>
                </Dato>
              )}
            </dl>
          </SectionCard>

          {verMovimientos && (
            <Link
              href={ruta(`/stock/movimientos?referenciaTipo=COMPRA&referenciaId=${c.id}`)}
              className={cardVariants({
                variant: "clickable",
                className: "text-body flex min-h-11 items-center gap-3 p-4 font-medium",
              })}
            >
              <History className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1">
                Ver los {c.movimientos} movimientos de stock que generó
              </span>
              <ChevronRight
                className="text-subtle size-5 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
            </Link>
          )}
        </div>
      </div>
      {barraMobile && <div className="h-[4.5rem] md:hidden" aria-hidden />}
    </>
  );
}

function Dato({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-muted text-small">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
