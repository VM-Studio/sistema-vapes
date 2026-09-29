import { EstadoDevolucion, Modulo } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ESTADO_DEVOLUCION_UI } from "@/components/clientes/etiquetas";
import { TelefonoWhatsApp } from "@/components/clientes/telefono-whatsapp";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerDevolucion } from "@/server/services/devolucion.service";

import { AnularDevolucion } from "./anular-devolucion";

export const metadata: Metadata = { title: "Devolución" };

export default async function DevolucionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.DEVOLUCIONES, "ver");
  const { slug } = ctx.panel;
  const { id } = await params;
  const d = await obtenerDevolucion(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const verClientes = puede(ctx.usuario, ctx.panelId, Modulo.CLIENTES, "ver");
  const verVentas = puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "ver");
  const anulada = d.estado === EstadoDevolucion.ANULADA;
  const unidades = d.items.reduce((a, i) => a + i.cantidad, 0);

  return (
    <>
      <PageHeader
        title={`Devolución ${d.codigo}`}
        className="[&_h1]:font-mono"
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Devoluciones", href: rutaPanel(slug, "/devoluciones") },
              { label: d.codigo },
            ]}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={ESTADO_DEVOLUCION_UI[d.estado].variante}>
              {ESTADO_DEVOLUCION_UI[d.estado].label}
            </Badge>
            <span>{formatearFechaHora(d.fecha)} · Garantía: se entregó una unidad nueva</span>
          </span>
        }
        actions={
          !anulada && esOwner(ctx.usuario) ? <AnularDevolucion id={d.id} codigo={d.codigo} /> : null
        }
      />
      {anulada && (
        <div className="bg-danger-soft text-danger-soft-foreground rounded-card mb-4 px-4 py-3 text-sm">
          Anulada {d.anuladaAt ? `el ${formatearFechaHora(d.anuladaAt)}` : ""}
          {d.anuladaPor ? ` por ${d.anuladaPor}` : ""}. Motivo: {d.motivoAnulacion}. La unidad
          volvió al stock de {d.deposito.nombre}.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title="Observación">
            <p className="text-body whitespace-pre-line" data-testid="observacion-devolucion">
              {d.observacion}
            </p>
          </SectionCard>
          <SectionCard
            title="Unidades nuevas entregadas"
            description={
              anulada
                ? "Se repusieron al stock al anular."
                : `Se descontaron ${unidades} unidad${unidades === 1 ? "" : "es"} del stock de ${d.deposito.nombre}.`
            }
          >
            <ul className="divide-border border-border bg-surface rounded-card flex flex-col divide-y border text-sm">
              {d.items.map((i) => (
                <li
                  key={i.varianteId}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0 font-medium">{i.titulo}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{i.cantidad}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
        <SectionCard title="Datos">
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted">Fecha</dt>
            <dd className="text-right">{formatearFechaHora(d.fecha)}</dd>
            <dt className="text-muted">Cliente</dt>
            <dd className="text-right">
              {verClientes ? (
                <Link
                  href={rutaPanel(slug, `/clientes/${d.cliente.id}`)}
                  className="text-foreground font-medium hover:underline"
                >
                  {d.cliente.nombre}
                </Link>
              ) : (
                <span className="font-medium">{d.cliente.nombre}</span>
              )}
            </dd>
            <dt className="text-muted">Teléfono</dt>
            <dd className="flex justify-end">
              <TelefonoWhatsApp telefono={d.cliente.telefono} />
            </dd>
            <dt className="text-muted">Venta</dt>
            <dd className="text-right">
              {d.venta ? (
                verVentas ? (
                  <Link
                    href={rutaPanel(slug, `/ventas/${d.venta.id}`)}
                    className="text-foreground font-mono font-semibold hover:underline"
                  >
                    {d.venta.codigo}
                  </Link>
                ) : (
                  <span className="font-mono font-semibold">{d.venta.codigo}</span>
                )
              ) : (
                <span className="text-muted">Sin vincular</span>
              )}
            </dd>
            <dt className="text-muted">Galpón</dt>
            <dd className="text-right">{d.deposito.nombre}</dd>
            <dt className="text-muted">Registró</dt>
            <dd className="text-right">{d.usuario}</dd>
          </dl>
        </SectionCard>
      </div>
    </>
  );
}
