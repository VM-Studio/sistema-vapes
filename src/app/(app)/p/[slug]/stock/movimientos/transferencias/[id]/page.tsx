import { Modulo } from "@prisma/client";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ESTADO_TRANSFERENCIA_UI } from "@/lib/movimientos-ui";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { cn, formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerTransferencia } from "@/server/services/movimiento.service";

import { StockTabs } from "../../movimientos-tabs";
import { AccionesTransferencia } from "./acciones-transferencia";

export const metadata: Metadata = { title: "Transferencia" };

export default async function TransferenciaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.STOCK, "ver");
  const { id } = await params;
  const t = await obtenerTransferencia(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const pendiente = t.estado === "PENDIENTE";

  return (
    <>
      <StockTabs panel={ctx.panel} usuario={ctx.usuario} actual="transferencias" />
      <PageHeader
        title={`Transferencia #${t.numero}`}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t.origen} <ArrowRight className="size-3.5" strokeWidth={1.75} aria-label="a" />{" "}
            {t.destino}
          </span>
        }
        actions={
          <Link
            href={rutaPanel(ctx.panel.slug, "/stock/movimientos/transferencias")}
            className={buttonVariants({ variant: "secondary" })}
          >
            <ArrowLeft strokeWidth={1.75} /> Transferencias
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <p className="text-muted">Estado</p>
              <Badge variant={ESTADO_TRANSFERENCIA_UI[t.estado].variante}>
                {ESTADO_TRANSFERENCIA_UI[t.estado].label}
              </Badge>
            </div>
            <div>
              <p className="text-muted">Creada</p>
              <p>{formatearFechaHora(t.fecha)}</p>
            </div>
            <div>
              <p className="text-muted">Por</p>
              <p>{t.usuario}</p>
            </div>
            <div>
              <p className="text-muted">Completada</p>
              <p>{formatearFechaHora(t.completadaAt)}</p>
            </div>
            {t.notas && (
              <div className="col-span-2 md:col-span-4">
                <p className="text-muted">Notas</p>
                <p className="whitespace-pre-line">{t.notas}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <ul className="divide-border border-border bg-surface flex flex-col divide-y rounded-2xl border">
          {t.items.map((i) => {
            const falta = pendiente && i.stockOrigen < i.cantidad;
            return (
              <li
                key={i.varianteId}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-3",
                  falta && "bg-danger-soft/40",
                )}
              >
                <div className="min-w-0">
                  <p className="font-medium">{i.nombre}</p>
                  <p className="text-muted text-xs">
                    {i.sku}
                    {pendiente && (
                      <span className={cn(falta && "text-danger font-medium")}>
                        {" "}
                        · hoy hay {i.stockOrigen} en {t.origen}
                      </span>
                    )}
                  </p>
                </div>
                <p className="text-2xl font-semibold tabular-nums">{i.cantidad}</p>
              </li>
            );
          })}
          <li className="flex justify-between px-4 py-3 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{t.unidades} unidades</span>
          </li>
        </ul>

        {pendiente && (
          <AccionesTransferencia
            id={t.id}
            numero={t.numero}
            puedeCompletar={puede(ctx.usuario, ctx.panelId, Modulo.STOCK, "editar")}
            puedeAnular={puede(ctx.usuario, ctx.panelId, Modulo.STOCK, "eliminar")}
          />
        )}
      </div>
    </>
  );
}
