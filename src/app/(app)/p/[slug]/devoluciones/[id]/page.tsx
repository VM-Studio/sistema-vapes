import { EstadoDevolucion, Modulo } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ESTADO_DEVOLUCION_UI } from "@/components/clientes/etiquetas";
import { TelefonoWhatsApp } from "@/components/clientes/telefono-whatsapp";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
      <PageHeaderDevolucion
        codigo={d.codigo}
        estado={
          <Badge variant={ESTADO_DEVOLUCION_UI[d.estado].variante}>
            {ESTADO_DEVOLUCION_UI[d.estado].label}
          </Badge>
        }
        volver={rutaPanel(slug, "/devoluciones")}
        accion={
          !anulada && esOwner(ctx.usuario) ? <AnularDevolucion id={d.id} codigo={d.codigo} /> : null
        }
      />
      {anulada && (
        <div className="bg-danger-soft text-danger-soft-foreground mb-4 rounded-card px-4 py-3 text-sm">
          Anulada {d.anuladaAt ? `el ${formatearFechaHora(d.anuladaAt)}` : ""}
          {d.anuladaPor ? ` por ${d.anuladaPor}` : ""}. Motivo: {d.motivoAnulacion}. La unidad
          volvió al stock de {d.deposito.nombre}.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="bg-card rounded-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Datos</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Fecha</dt>
            <dd>{formatearFechaHora(d.fecha)}</dd>
            <dt className="text-muted">Cliente</dt>
            <dd>
              {verClientes ? (
                <Link
                  href={rutaPanel(slug, `/clientes/${d.cliente.id}`)}
                  className="text-primary font-medium hover:underline"
                >
                  {d.cliente.nombre}
                </Link>
              ) : (
                d.cliente.nombre
              )}
              <TelefonoWhatsApp telefono={d.cliente.telefono} className="text-muted ml-2 text-xs" />
            </dd>
            <dt className="text-muted">Venta</dt>
            <dd>
              {d.venta ? (
                verVentas ? (
                  <Link
                    href={rutaPanel(slug, `/ventas/${d.venta.id}`)}
                    className="text-primary font-semibold tabular-nums hover:underline"
                  >
                    {d.venta.codigo}
                  </Link>
                ) : (
                  <span className="tabular-nums">{d.venta.codigo}</span>
                )
              ) : (
                <span className="text-muted">Sin vincular</span>
              )}
            </dd>
            <dt className="text-muted">Galpón</dt>
            <dd>{d.deposito.nombre}</dd>
            <dt className="text-muted">Registró</dt>
            <dd>{d.usuario}</dd>
          </dl>
        </section>
        <section className="bg-card rounded-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Observación</h2>
          <p className="text-sm whitespace-pre-line" data-testid="observacion-devolucion">
            {d.observacion}
          </p>
        </section>
      </div>
      <section className="border-border bg-surface mt-4 rounded-card border p-5">
        <h2 className="mb-1 text-sm font-semibold">Unidades nuevas entregadas</h2>
        <p className="text-muted mb-3 text-xs">
          {anulada
            ? "Se repusieron al stock al anular."
            : `Se descontaron ${unidades} unidad${unidades === 1 ? "" : "es"} del stock de ${d.deposito.nombre}.`}
        </p>
        <ul className="divide-border flex flex-col divide-y text-sm">
          {d.items.map((i) => (
            <li key={i.varianteId} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">{i.titulo}</span>
              <strong className="shrink-0 tabular-nums">{i.cantidad}</strong>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function PageHeaderDevolucion({
  codigo,
  estado,
  volver,
  accion,
}: {
  codigo: string;
  estado: React.ReactNode;
  volver: string;
  accion: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="flex items-center gap-3 text-2xl leading-tight font-semibold tracking-tight tabular-nums md:text-3xl">
          Devolución {codigo} {estado}
        </h1>
        <p className="text-muted text-sm md:text-base">Garantía: se entregó una unidad nueva</p>
      </div>
      <div className="flex flex-wrap gap-2 md:flex-nowrap [&>*]:flex-1 md:[&>*]:flex-none">
        <Link href={volver} className={buttonVariants({ variant: "secondary" })}>
          <ArrowLeft strokeWidth={1.75} /> Devoluciones
        </Link>
        {accion}
      </div>
    </div>
  );
}
