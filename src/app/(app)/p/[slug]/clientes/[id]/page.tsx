import { Modulo } from "@prisma/client";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { puede } from "@/lib/permisos";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import { ESTADO_VENTA_UI, ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerCliente } from "@/server/services/cliente.service";

import { AccionesCliente } from "./acciones-cliente";

export const metadata: Metadata = { title: "Cliente" };

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.CLIENTES, "ver");
  const { slug } = ctx.panel;
  const { id } = await params;
  const detalle = await obtenerCliente(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { cliente: c } = detalle;
  const puedeEn = (modulo: Modulo, accion: "ver" | "crear" | "editar" | "eliminar") =>
    puede(ctx.usuario, ctx.panelId, modulo, accion);
  const verVentas = puedeEn(Modulo.VENTAS, "ver");
  const hrefVenta = (ventaId: string) => rutaPanel(slug, `/ventas/${ventaId}`);

  return (
    <>
      <PageHeader
        title={c.nombreCompleto}
        subtitle={
          [c.telefono, c.documento ? `Doc. ${c.documento}` : null, c.email]
            .filter(Boolean)
            .join(" · ") || "Sin datos de contacto"
        }
        actions={
          <>
            <Link
              href={rutaPanel(slug, "/clientes")}
              className={buttonVariants({ variant: "secondary" })}
            >
              <ArrowLeft strokeWidth={1.75} /> Clientes
            </Link>
            {puedeEn(Modulo.VENTAS, "crear") && c.activo && (
              <Link
                href={rutaPanel(slug, `/ventas/nueva?cliente=${c.id}`)}
                className={buttonVariants()}
              >
                <ShoppingCart strokeWidth={1.75} /> Nueva venta
              </Link>
            )}
          </>
        }
      />
      <section
        aria-label="Resumen de compras"
        className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3"
      >
        <StatCard label="Compras" value={String(detalle.compras.cantidad)} />
        <StatCard label="Total comprado" value={formatearPesos(detalle.compras.total)} />
        <StatCard
          label="Última compra"
          value={detalle.compras.ultima ? formatearFecha(detalle.compras.ultima) : "—"}
        />
      </section>

      {(c.direccion || c.notas) && (
        <dl className="border-border bg-surface mb-4 grid gap-3 rounded-2xl border p-4 text-sm md:grid-cols-2">
          {c.direccion && (
            <div>
              <dt className="text-muted">Dirección</dt>
              <dd>{c.direccion}</dd>
            </div>
          )}
          {c.notas && (
            <div>
              <dt className="text-muted">Notas</dt>
              <dd className="whitespace-pre-line">{c.notas}</dd>
            </div>
          )}
        </dl>
      )}

      <AccionesCliente
        cliente={{
          id: c.id,
          nombre: c.nombre,
          apellido: c.apellido,
          documento: c.documento,
          telefono: c.telefono,
          email: c.email,
          direccion: c.direccion,
          notas: c.notas,
          activo: c.activo,
        }}
        puedeEditar={puedeEn(Modulo.CLIENTES, "editar")}
        puedeEliminar={puedeEn(Modulo.CLIENTES, "eliminar")}
      />

      <h2 className="mt-6 mb-3 text-lg font-semibold">Historial de compras</h2>
      <DataTable
        caption="Compras del cliente"
        rows={detalle.ventas}
        getRowKey={(v) => v.id}
        empty={<EmptyState icon={ShoppingCart} title="Todavía no compró" />}
        columns={[
          {
            key: "numero",
            header: "ID",
            cell: (v) =>
              verVentas ? (
                <Link
                  href={hrefVenta(v.id)}
                  className="text-primary font-semibold tabular-nums hover:underline"
                >
                  {v.idVenta}
                </Link>
              ) : (
                <span className="tabular-nums">{v.idVenta}</span>
              ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (v) => <span className="text-muted">{formatearFechaHora(v.fecha)}</span>,
          },
          {
            key: "medio",
            header: "Pago",
            cell: (v) => (v.medioPago ? ETIQUETA_MEDIO_PAGO[v.medioPago] : "—"),
          },
          {
            key: "total",
            header: "Total",
            className: "text-right tabular-nums",
            cell: (v) => formatearPesos(v.total),
          },
          {
            key: "estado",
            header: "Estado",
            cell: (v) => (
              <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>
                {ESTADO_VENTA_UI[v.estado].label}
              </Badge>
            ),
          },
        ]}
        renderMobile={(v) => {
          const contenido = (
            <>
              <div className="flex justify-between gap-2">
                <span className="font-semibold tabular-nums">{v.idVenta}</span>
                <span className="font-semibold tabular-nums">{formatearPesos(v.total)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted text-xs">
                  {formatearFechaHora(v.fecha)}
                  {v.medioPago && ` · ${ETIQUETA_MEDIO_PAGO[v.medioPago]}`}
                </span>
                <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>
                  {ESTADO_VENTA_UI[v.estado].label}
                </Badge>
              </div>
            </>
          );
          const clase = "border-border bg-surface block rounded-2xl border p-4";
          return verVentas ? (
            <Link href={hrefVenta(v.id)} className={clase}>
              {contenido}
            </Link>
          ) : (
            <div className={clase}>{contenido}</div>
          );
        }}
      />
    </>
  );
}
