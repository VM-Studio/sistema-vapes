import { Modulo } from "@prisma/client";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { formatearNumero } from "@/lib/format";
import { ESTADO_TRANSFERENCIA_UI } from "@/lib/movimientos-ui";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { cn, formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerTransferencia } from "@/server/services/movimiento.service";

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

  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  const estadoUi = ESTADO_TRANSFERENCIA_UI[t.estado];

  return (
    <>
      <PageHeader
        title={`Transferencia #${t.numero}`}
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Stock", href: ruta("/stock") },
              { label: "Transferencias", href: ruta("/stock/movimientos/transferencias") },
              { label: `#${t.numero}` },
            ]}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              {t.origen}{" "}
              <ArrowRight className="text-muted size-4" strokeWidth={1.75} aria-label="a" />{" "}
              {t.destino}
            </span>
            <Badge variant={estadoUi.variante}>{estadoUi.label}</Badge>
          </span>
        }
        actions={
          pendiente ? (
            <AccionesTransferencia
              id={t.id}
              numero={t.numero}
              puedeCompletar={puede(ctx.usuario, ctx.panelId, Modulo.STOCK, "editar")}
              puedeAnular={puede(ctx.usuario, ctx.panelId, Modulo.STOCK, "eliminar")}
            />
          ) : undefined
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <SectionCard
          title="Productos"
          description={`${t.items.length} ${t.items.length === 1 ? "producto" : "productos"} · ${formatearNumero(t.unidades)} unidades`}
          className="lg:col-span-2"
          contentClassName="flex flex-col gap-4"
        >
          <ul
            aria-label="Productos transferidos"
            className="divide-border border-border bg-surface rounded-card flex flex-col divide-y overflow-hidden border"
          >
            {t.items.map((i) => {
              const falta = pendiente && i.stockOrigen < i.cantidad;
              return (
                <li
                  key={i.varianteId}
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-3",
                    falta && "bg-danger-soft",
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{i.nombre}</p>
                    <p className="text-muted text-small">
                      {i.sku}
                      {pendiente && (
                        <span className={cn(falta && "text-danger font-medium")}>
                          {" "}
                          · hoy hay {i.stockOrigen} en {t.origen}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="text-h3 shrink-0 font-semibold tabular-nums">
                    {formatearNumero(i.cantidad)} u.
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="border-border flex items-baseline justify-between gap-3 border-t pt-4">
            <span className="text-h3 font-semibold">Total</span>
            <span className="text-h3 font-semibold tabular-nums">
              {formatearNumero(t.unidades)} unidades
            </span>
          </div>
        </SectionCard>

        <SectionCard title="Datos de la transferencia">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-1">
            <Dato label="Estado">
              <Badge variant={estadoUi.variante}>{estadoUi.label}</Badge>
            </Dato>
            <Dato label="Creada">{formatearFechaHora(t.fecha)}</Dato>
            <Dato label="Por">{t.usuario}</Dato>
            <Dato label="Completada">{formatearFechaHora(t.completadaAt)}</Dato>
            {t.notas && (
              <Dato label="Notas" className="col-span-2 lg:col-span-1">
                <span className="whitespace-pre-line">{t.notas}</span>
              </Dato>
            )}
          </dl>
        </SectionCard>
      </div>
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
