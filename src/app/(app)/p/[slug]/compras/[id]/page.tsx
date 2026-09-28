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
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerCompra } from "@/server/services/compra.service";

import { AccionesCompra } from "./acciones-compra";

export const metadata: Metadata = { title: "Compra" };

export default async function CompraPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.COMPRAS, "ver");
  const { usuario, panelId } = ctx;
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  const { id } = await params;
  const c = await obtenerCompra(ctx, id, { incluirCostoActual: esOwner(usuario) }).catch(
    (e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    },
  );
  const cambiosDeCosto = c.items.flatMap((i) =>
    i.precioCostoActual !== null && Number(i.costoUnitario) !== Number(i.precioCostoActual)
      ? [{ nombre: i.nombre, antes: i.precioCostoActual, despues: i.costoUnitario }]
      : [],
  );
  const verMovimientos = c.movimientos > 0 && puede(usuario, panelId, Modulo.STOCK, "ver");

  return (
    <>
      <PageHeader
        title={`Compra #${c.numero}`}
        subtitle={c.proveedor ?? "Sin proveedor"}
        actions={
          <Link href={ruta("/compras")} className={buttonVariants({ variant: "secondary" })}>
            <ArrowLeft /> Compras
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
              <p className="text-muted">Depósito</p>
              <p>{c.deposito}</p>
            </div>
            <div>
              <p className="text-muted">Cargada por</p>
              <p>{c.usuario}</p>
            </div>
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
          className="divide-border border-border bg-surface shadow-card flex flex-col divide-y rounded-2xl border"
        >
          {c.items.map((i) => (
            <li key={i.varianteId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{i.nombre}</p>
                <p className="text-muted text-xs">
                  {i.sku} · {i.cantidad} × {formatearPesos(i.costoUnitario)}
                  {c.estado === "BORRADOR" &&
                    i.precioCostoActual !== null &&
                    Number(i.costoUnitario) !== Number(i.precioCostoActual) && (
                      <span className="text-warning-soft-foreground">
                        {" "}
                        · costo actual {formatearPesos(i.precioCostoActual)}
                      </span>
                    )}
                </p>
              </div>
              <p className="font-semibold tabular-nums">{formatearPesos(i.subtotal)}</p>
            </li>
          ))}
          <li className="flex flex-col gap-1 px-4 py-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal ({c.unidades} unidades)</span>
              <span className="tabular-nums">{formatearPesos(c.subtotal)}</span>
            </div>
            {Number(c.descuento) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Descuento</span>
                <span className="tabular-nums">−{formatearPesos(c.descuento)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatearPesos(c.total)}</span>
            </div>
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
            <History /> Ver sus {c.movimientos} movimientos de stock
          </Link>
        )}

        <AccionesCompra
          id={c.id}
          numero={c.numero}
          estado={c.estado}
          unidades={c.unidades}
          deposito={c.deposito}
          cambiosDeCosto={cambiosDeCosto}
          puedeEditar={puede(usuario, panelId, Modulo.COMPRAS, "editar")}
          puedeAnular={puede(usuario, panelId, Modulo.COMPRAS, "eliminar")}
        />
      </div>
    </>
  );
}
