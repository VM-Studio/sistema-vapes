import { Modulo } from "@prisma/client";
import { UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TelefonoWhatsApp } from "@/components/clientes/telefono-whatsapp";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { puede, tieneCarteraClientes } from "@/lib/permisos";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import { ESTADO_VENTA_UI, ETIQUETA_TIPO_VENTA } from "@/lib/ventas-ui";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import {
  obtenerClienteDeCartera,
  type ClienteDeCartera,
} from "@/server/services/cartera-clientes.service";

import { AccionesClienteCartera } from "../acciones-cartera";

export const metadata: Metadata = { title: "Cliente" };

type VentaFila = ClienteDeCartera["ventas"][number];

/**
 * Ficha de un cliente de «Mis clientes»: cómo entró a la cartera (la venta
 * con la que se dio de alta como nuevo, o que ya lo tenía) y las ventas que
 * le hizo el vendedor.
 */
export default async function ClienteCarteraPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanelUsuario();
  const ruta = (r: string) => rutaPanel(ctx.panel.slug, r);
  if (!tieneCarteraClientes(ctx.usuario, ctx.panelId)) redirect(ruta("/"));
  const { id } = await params;
  const d = await obtenerClienteDeCartera(ctx, ctx.usuarioId, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const c = d.cliente;
  const verVentas = puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "ver");
  const codigoVenta = (v: { id: string; codigo: string }) =>
    verVentas ? (
      <Link href={ruta(`/ventas/${v.id}`)} className="font-mono font-semibold hover:underline">
        {v.codigo}
      </Link>
    ) : (
      <span className="font-mono font-semibold">{v.codigo}</span>
    );

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-2 flex flex-col gap-4 md:mb-4">
        <Breadcrumb
          items={[{ label: "Mis clientes", href: ruta("/mis-clientes") }, { label: c.nombre }]}
        />
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-h1 font-semibold">{c.nombre}</h1>
            <TelefonoWhatsApp telefono={c.telefono} className="text-muted" />
          </div>
          <AccionesClienteCartera
            cliente={{ id: c.id, nombre: c.nombre, telefono: c.telefono, notas: c.notas }}
            puedeQuitar={c.ventaAlta === null}
          />
        </div>
      </header>

      <section
        aria-label="Cómo entró a tu cartera"
        className={
          c.ventaAlta
            ? "bg-success-soft text-success-soft-foreground rounded-card flex items-start gap-3 p-4"
            : "bg-card rounded-card flex items-start gap-3 p-4"
        }
        data-testid="origen-cliente-cartera"
      >
        <UserPlus className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
        {c.ventaAlta ? (
          <p className="text-sm">
            <strong>Cliente nuevo:</strong> se sumó a tu cartera con la venta{" "}
            {codigoVenta(c.ventaAlta)} del {formatearFechaHora(c.ventaAlta.fecha)} (
            {formatearPesos(c.ventaAlta.total)}). Esa venta cuenta como cliente nuevo en tu
            ganancia.
          </p>
        ) : (
          <p className="text-sm">
            <strong>Ya lo tenías:</strong> lo cargaste en tu cartera el{" "}
            {formatearFecha(c.createdAt)}. Venderle no cuenta como cliente nuevo.
          </p>
        )}
      </section>

      {c.notas && (
        <SectionCard title="Notas">
          <p className="whitespace-pre-line">{c.notas}</p>
        </SectionCard>
      )}

      <SectionCard
        title="Tus ventas a este cliente"
        description={`${formatearNumero(d.ventas.length)} ${d.ventas.length === 1 ? "venta" : "ventas"}`}
      >
        <DataTable
          caption="Ventas al cliente"
          rows={d.ventas}
          getRowKey={(v) => v.id}
          empty={<EmptyState title="Todavía no le vendiste" className="bg-surface py-10" />}
          columns={[
            { key: "codigo", header: "ID", cell: (v: VentaFila) => codigoVenta(v) },
            { key: "fecha", header: "Fecha", cell: (v: VentaFila) => formatearFechaHora(v.fecha) },
            {
              key: "tipo",
              header: "Tipo",
              cell: (v: VentaFila) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={v.tipo === "MAYORISTA" ? "primary" : "neutral"}>
                    {ETIQUETA_TIPO_VENTA[v.tipo]}
                  </Badge>
                  {v.clienteNuevo && <Badge variant="success">Cliente nuevo</Badge>}
                </span>
              ),
            },
            {
              key: "unidades",
              header: "Unidades",
              className: "text-right tabular-nums",
              cell: (v: VentaFila) => v.unidades,
            },
            {
              key: "total",
              header: "Total",
              className: "text-right tabular-nums",
              cell: (v: VentaFila) => formatearPesos(v.total),
            },
            {
              key: "estado",
              header: "Estado",
              cell: (v: VentaFila) => (
                <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>
                  {ESTADO_VENTA_UI[v.estado].label}
                </Badge>
              ),
            },
          ]}
          renderMobile={(v: VentaFila) => (
            <div className="border-border bg-surface rounded-card flex flex-col gap-1 border p-4">
              <div className="flex items-center justify-between gap-2">
                {codigoVenta(v)}
                <span className="font-semibold tabular-nums">{formatearPesos(v.total)}</span>
              </div>
              <p className="text-muted text-small">
                {formatearFechaHora(v.fecha)} · {ETIQUETA_TIPO_VENTA[v.tipo]} · {v.unidades} u.
                {v.estado === "ANULADA" ? " · Anulada" : ""}
              </p>
              {v.clienteNuevo && (
                <Badge variant="success" className="self-start">
                  Cliente nuevo
                </Badge>
              )}
            </div>
          )}
        />
      </SectionCard>
    </div>
  );
}
