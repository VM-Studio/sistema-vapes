import { Modulo } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import { telefonoVisible } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtener, textoWhatsApp } from "@/server/services/cotizacion.service";

import {
  esConvertible,
  esEditable,
  ESTADO_COTIZACION_UI,
  ETIQUETA_TIPO_COTIZACION,
} from "../estado-cotizacion";
import { AccionesCotizacion } from "./acciones-cotizacion";

export const metadata: Metadata = { title: "Cotización" };

export default async function DetalleCotizacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanel(Modulo.COTIZADOR, "ver");
  const { id } = await params;
  const sp = await searchParams;
  const c = await obtener(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const wa = await textoWhatsApp(ctx, id);
  const whatsapp = `https://wa.me/${wa.telefono ? wa.telefono.replace(/\D/g, "") : ""}?text=${encodeURIComponent(wa.texto)}`;
  const mayorista = c.tipo === "MAYORISTA";
  const ui = ESTADO_COTIZACION_UI[c.estado];
  const puedeCrear = puede(ctx.usuario, ctx.panelId, Modulo.COTIZADOR, "crear");

  return (
    <>
      <Link
        href={rutaPanel(ctx.panel.slug, "/cotizador")}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-2 -ml-2" })}
      >
        <ArrowLeft strokeWidth={1.75} /> Cotizaciones
      </Link>
      <header className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            className="text-3xl font-bold tracking-tight tabular-nums"
            data-testid="codigo-cotizacion"
          >
            {c.codigo}
          </h1>
          <Badge variant={ui.variante} data-testid="estado-cotizacion">
            {ui.label}
          </Badge>
          <Badge>{ETIQUETA_TIPO_COTIZACION[c.tipo]}</Badge>
        </div>
        <p className="text-muted text-sm">
          {formatearFechaHora(c.fecha)} · {c.vendedor.nombre} · válida hasta{" "}
          {formatearFecha(c.validaHasta)}
        </p>
        {c.cliente && (
          <p className="text-sm">
            <span className="font-medium">{c.cliente.nombre}</span>
            {c.cliente.telefono && (
              <span className="text-muted tabular-nums">
                {" "}
                · {telefonoVisible(c.cliente.telefono)}
              </span>
            )}
            {!c.cliente.id && <span className="text-muted"> (sin registrar)</span>}
          </p>
        )}
        {c.venta && (
          <p className="bg-success-soft text-success-soft-foreground rounded-xl px-4 py-3 text-sm">
            Convertida en la venta{" "}
            <Link
              href={rutaPanel(ctx.panel.slug, `/ventas/${c.venta.id}`)}
              className="font-semibold underline"
              data-testid="venta-de-cotizacion"
            >
              {c.venta.codigo}
            </Link>
          </p>
        )}
        {c.motivoRechazo && (
          <p className="text-muted text-sm">Motivo del rechazo: {c.motivoRechazo}</p>
        )}
      </header>

      <AccionesCotizacion
        id={c.id}
        codigo={c.codigo}
        estado={c.estado}
        vencida={c.vencida}
        whatsapp={whatsapp}
        editable={puedeCrear && esEditable(c.estado)}
        puedeCrear={puedeCrear}
        convertible={
          esConvertible(c.estado) && puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "crear")
        }
        convertirAlCargar={sp.convertir === "1"}
      />

      <section aria-label="Productos" className="border-border bg-surface mt-4 rounded-2xl border">
        <ul className="divide-border divide-y">
          {c.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{i.titulo}</span>
                <span className="text-muted tabular-nums">
                  {i.cantidad} × {formatearPesos(i.precioUnitario)}
                  {i.precioUnitario !== i.precioLista && (
                    <s className="ml-1">{formatearPesos(i.precioLista)}</s>
                  )}
                  {mayorista && i.escalonAplicado !== null && ` · escalón ${i.escalonAplicado}+`}
                  {i.esPrecioManual && " · precio manual"}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatearPesos(i.subtotal)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="border-border grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t px-4 py-3 text-sm">
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-right tabular-nums">{formatearPesos(c.subtotal)}</dd>
          {Number(c.descuento) > 0 && (
            <>
              <dt className="text-muted">Descuento</dt>
              <dd className="text-right tabular-nums">−{formatearPesos(c.descuento)}</dd>
            </>
          )}
          <dt className="text-lg font-semibold">Total</dt>
          <dd
            className="text-right text-lg font-semibold tabular-nums"
            data-testid="total-cotizacion"
          >
            {formatearPesos(c.total)}
          </dd>
        </dl>
      </section>

      {mayorista && c.resumenEscalones.length > 0 && (
        <section className="border-border bg-surface mt-4 rounded-2xl border p-4">
          <h2 className="mb-2 font-semibold">Resumen de escalones</h2>
          <ul className="flex flex-col gap-1 text-sm tabular-nums">
            {c.resumenEscalones.map((r) => (
              <li key={r.productoId} className="flex justify-between gap-3">
                <span>
                  {r.nombreCompleto} · {r.unidades} u.
                  {r.escalonAplicado !== null ? ` · escalón ${r.escalonAplicado}+` : " · lista"}
                </span>
                <span className="font-medium">{formatearPesos(r.precioUnitario)} c/u</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {c.notas && <p className="text-muted mt-4 text-sm whitespace-pre-line">{c.notas}</p>}
    </>
  );
}
