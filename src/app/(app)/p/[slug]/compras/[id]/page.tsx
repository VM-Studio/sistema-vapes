import { Modulo } from "@prisma/client";
import { ArrowLeft, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatearPesos } from "@/lib/format";
import { ESTADO_COMPRA_UI } from "@/lib/movimientos-ui";
import { formatearIdCompra, rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
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

  return (
    <>
      <PageHeader
        title={`Compra ${idVisible}`}
        subtitle={c.proveedor ?? "Sin proveedor"}
        actions={
          <Link href={ruta("/compras")} className={buttonVariants({ variant: "secondary" })}>
            <ArrowLeft strokeWidth={1.75} /> Compras
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <p className="text-muted">Estado</p>
              <Badge variant={ESTADO_COMPRA_UI[c.estado].variante}>
                {ESTADO_COMPRA_UI[c.estado].label}
              </Badge>
            </div>
            <div>
              <p className="text-muted">Fecha</p>
              <p>{formatearFechaHora(c.fecha)}</p>
            </div>
            <div>
              <p className="text-muted">Galpón</p>
              <p>{c.deposito}</p>
            </div>
            <div>
              <p className="text-muted">Cargada por</p>
              <p>{c.usuario}</p>
            </div>
            {c.proveedorId && puede(usuario, panelId, Modulo.PROVEEDORES, "ver") && (
              <div className="col-span-2">
                <p className="text-muted">Proveedor</p>
                <Link
                  href={ruta(`/proveedores/${c.proveedorId}`)}
                  className="text-primary font-medium hover:underline"
                >
                  {c.proveedor}
                </Link>
              </div>
            )}
            {c.notas && (
              <div className="col-span-2 md:col-span-4">
                <p className="text-muted">Notas</p>
                <p className="whitespace-pre-line">{c.notas}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <ul
          aria-label="Ítems"
          className="divide-border border-border bg-surface flex flex-col divide-y rounded-card border"
        >
          {c.items.map((i) => (
            <li key={i.varianteId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{i.nombreCompleto}</p>
                <p className="text-muted text-xs">
                  {i.sabor ? `${i.sabor} · ` : ""}
                  {i.sku} · {i.cantidad} u.
                  {verCostos && ` × ${formatearPesos(i.costoUnitario)}`}
                </p>
              </div>
              {verCostos && (
                <p className="font-semibold tabular-nums">{formatearPesos(i.subtotal)}</p>
              )}
            </li>
          ))}
          <li className="flex justify-between px-4 py-3 text-base font-semibold">
            <span>
              Total <span className="text-muted text-sm font-normal">({c.unidades} unidades)</span>
            </span>
            {verCostos && <span className="tabular-nums">{formatearPesos(c.total)}</span>}
          </li>
        </ul>

        {verMovimientos && (
          <Link
            href={ruta(`/stock/movimientos?referenciaTipo=COMPRA&referenciaId=${c.id}`)}
            className={buttonVariants({
              variant: "ghost",
              className: "text-primary h-auto min-h-11 self-start py-2 whitespace-normal",
            })}
          >
            <History strokeWidth={1.75} /> Ver los {c.movimientos} movimientos de stock que generó
          </Link>
        )}

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
      </div>
    </>
  );
}
