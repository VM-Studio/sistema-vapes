import { Modulo } from "@prisma/client";
import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card } from "@/components/ui/card";
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

  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3">
        <Breadcrumb
          items={[{ label: "Cotizador", href: ruta("/cotizador") }, { label: c.codigo }]}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-h1 font-mono font-semibold" data-testid="codigo-cotizacion">
            {c.codigo}
          </h1>
          <Badge variant={ui.variante} data-testid="estado-cotizacion">
            {ui.label}
          </Badge>
          <Badge>{ETIQUETA_TIPO_COTIZACION[c.tipo]}</Badge>
        </div>
        <p className="text-muted text-small">
          {formatearFechaHora(c.fecha)} · {c.vendedor.nombre} · válida hasta{" "}
          {formatearFecha(c.validaHasta)}
        </p>
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

      {c.venta && (
        <p className="bg-success-soft text-success-soft-foreground rounded-control mt-4 flex items-center gap-2 px-4 py-3 text-sm">
          <CircleCheck className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>
            Convertida en la venta{" "}
            <Link
              href={ruta(`/ventas/${c.venta.id}`)}
              className="font-mono font-semibold underline underline-offset-2"
              data-testid="venta-de-cotizacion"
            >
              {c.venta.codigo}
            </Link>
          </span>
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <Card className="flex flex-col gap-4 p-4 md:p-6">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-h3 font-semibold">Productos</h2>
            <span className="text-muted text-small tabular-nums">
              {c.items.reduce((a, i) => a + i.cantidad, 0)} u.
            </span>
          </div>
          <section
            aria-label="Productos"
            className="border-border bg-surface rounded-card overflow-hidden border"
          >
            <div className="bg-card border-border text-muted hidden grid-cols-[minmax(0,1fr)_5rem_8rem_8rem] gap-3 border-b px-4 py-2.5 text-xs font-medium md:grid">
              <span>Producto</span>
              <span className="text-right">Cant.</span>
              <span className="text-right">Precio c/u</span>
              <span className="text-right">Subtotal</span>
            </div>
            <ul className="divide-border divide-y">
              {c.items.map((i) => (
                <li
                  key={i.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_5rem_8rem_8rem]"
                >
                  <span className="min-w-0">
                    <span className="block leading-snug font-medium">{i.titulo}</span>
                    <span className="text-muted text-xs tabular-nums">
                      <span className="md:hidden">
                        {i.cantidad} × {formatearPesos(i.precioUnitario)}
                      </span>
                      {i.precioUnitario !== i.precioLista && (
                        <s className="text-subtle ml-1 md:ml-0">
                          lista {formatearPesos(i.precioLista)}
                        </s>
                      )}
                      {mayorista &&
                        i.escalonAplicado !== null &&
                        ` · escalón ${i.escalonAplicado}+`}
                      {i.esPrecioManual && " · precio manual"}
                    </span>
                  </span>
                  <span className="hidden text-right tabular-nums md:block">{i.cantidad}</span>
                  <span className="hidden text-right tabular-nums md:block">
                    {formatearPesos(i.precioUnitario)}
                  </span>
                  <span className="text-right font-semibold tabular-nums">
                    {formatearPesos(i.subtotal)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="border-border bg-card grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t px-4 py-3 text-sm">
              <dt className="text-muted">Subtotal</dt>
              <dd className="text-right tabular-nums">{formatearPesos(c.subtotal)}</dd>
              {Number(c.descuento) > 0 && (
                <>
                  <dt className="text-muted">Descuento</dt>
                  <dd className="text-right tabular-nums">−{formatearPesos(c.descuento)}</dd>
                </>
              )}
              <dt className="text-h3 pt-1 font-semibold">Total</dt>
              <dd
                className="text-h2 pt-1 text-right font-bold tabular-nums"
                data-testid="total-cotizacion"
              >
                {formatearPesos(c.total)}
              </dd>
            </dl>
          </section>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-h3 font-semibold">Cliente</h2>
            {c.cliente ? (
              <div className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium">
                  {c.cliente.nombre}
                  {!c.cliente.id && (
                    <span className="text-muted font-normal"> (sin registrar)</span>
                  )}
                </span>
                {c.cliente.telefono && (
                  <span className="text-muted tabular-nums">
                    {telefonoVisible(c.cliente.telefono)}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-muted text-sm">Sin cliente</p>
            )}
            {c.motivoRechazo && (
              <p className="text-muted border-border border-t pt-3 text-sm">
                Motivo del rechazo: {c.motivoRechazo}
              </p>
            )}
          </Card>

          {mayorista && c.resumenEscalones.length > 0 && (
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-h3 font-semibold">Resumen de escalones</h2>
              <ul className="border-border bg-surface divide-border rounded-card flex flex-col divide-y border text-sm tabular-nums">
                {c.resumenEscalones.map((r) => (
                  <li key={r.productoId} className="flex flex-col gap-0.5 px-4 py-3">
                    <span className="leading-snug font-medium">{r.nombreCompleto}</span>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-muted">
                        {r.unidades} u.
                        {r.escalonAplicado !== null
                          ? ` · escalón ${r.escalonAplicado}+`
                          : " · lista"}
                      </span>
                      <span className="font-semibold whitespace-nowrap">
                        {formatearPesos(r.precioUnitario)} c/u
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {c.notas && (
            <Card className="flex flex-col gap-2 p-5">
              <h2 className="text-h3 font-semibold">Notas</h2>
              <p className="text-muted text-sm whitespace-pre-line">{c.notas}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
