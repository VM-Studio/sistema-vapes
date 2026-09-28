import { Modulo } from "@prisma/client";
import { ArrowLeft, ShoppingCart, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ESTADO_DEVOLUCION_UI,
  ESTADO_VENTA_CLIENTE,
  MEDIO_PAGO_LABEL,
} from "@/components/clientes/etiquetas";
import { TelefonoWhatsApp } from "@/components/clientes/telefono-whatsapp";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerCliente } from "@/server/services/cliente.service";

import { AccionesCliente } from "./acciones-cliente";

export const metadata: Metadata = { title: "Cliente" };

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePaginaPanel(Modulo.CLIENTES, "ver");
  const { slug } = ctx.panel;
  const { id } = await params;
  const verTotales = esOwner(ctx.usuario);
  const detalle = await obtenerCliente(ctx, id, { verTotales }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { cliente: c } = detalle;
  const puedeEn = (modulo: Modulo, accion: "ver" | "crear" | "editar" | "eliminar") =>
    puede(ctx.usuario, ctx.panelId, modulo, accion);
  const verVentas = puedeEn(Modulo.VENTAS, "ver");
  const verDevoluciones = puedeEn(Modulo.DEVOLUCIONES, "ver");
  const crearDevolucion = puedeEn(Modulo.DEVOLUCIONES, "crear") && c.activo;
  const hrefVenta = (ventaId: string) => rutaPanel(slug, `/ventas/${ventaId}`);
  const hrefDevolucion = (devId: string) => rutaPanel(slug, `/devoluciones/${devId}`);

  return (
    <>
      <PageHeader
        title={c.nombre}
        subtitle={<TelefonoWhatsApp telefono={c.telefono} />}
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
                href={rutaPanel(slug, `/ventas?nueva=1&cliente=${c.id}`)}
                className={buttonVariants()}
              >
                <ShoppingCart strokeWidth={1.75} /> Nueva venta
              </Link>
            )}
          </>
        }
      />
      {!c.activo && (
        <p className="bg-warning-soft text-warning-soft-foreground mb-4 rounded-xl px-4 py-3 text-sm">
          Cliente desactivado: no aparece en los buscadores. Sus ventas y devoluciones se conservan.
        </p>
      )}
      <section
        aria-label="Resumen de compras"
        className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3"
      >
        <StatCard label="Compras" value={String(detalle.compras.cantidad)} />
        {detalle.compras.total !== null && (
          <StatCard label="Total comprado" value={formatearPesos(detalle.compras.total)} />
        )}
        <StatCard
          label="Última compra"
          value={detalle.compras.ultima ? formatearFecha(detalle.compras.ultima) : "—"}
        />
      </section>

      <dl className="border-border bg-surface mb-4 grid gap-3 rounded-2xl border p-4 text-sm md:grid-cols-2">
        <div>
          <dt className="text-muted">Cliente desde</dt>
          <dd>{formatearFecha(c.createdAt)}</dd>
        </div>
        {c.notas && (
          <div>
            <dt className="text-muted">Notas</dt>
            <dd className="whitespace-pre-line">{c.notas}</dd>
          </div>
        )}
      </dl>

      <AccionesCliente
        cliente={{ id: c.id, nombre: c.nombre, telefono: c.telefono, notas: c.notas }}
        activo={c.activo}
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
            key: "codigo",
            header: "ID",
            cell: (v) =>
              verVentas ? (
                <Link
                  href={hrefVenta(v.id)}
                  className="text-primary font-semibold tabular-nums hover:underline"
                >
                  {v.codigo}
                </Link>
              ) : (
                <span className="tabular-nums">{v.codigo}</span>
              ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (v) => <span className="text-muted">{formatearFechaHora(v.fecha)}</span>,
          },
          { key: "medio", header: "Pago", cell: (v) => MEDIO_PAGO_LABEL[v.medioPago] },
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
              <Badge variant={ESTADO_VENTA_CLIENTE[v.estado].variante}>
                {ESTADO_VENTA_CLIENTE[v.estado].label}
              </Badge>
            ),
          },
          ...(crearDevolucion
            ? [
                {
                  key: "garantia",
                  header: <span className="sr-only">Garantía</span>,
                  className: "text-right",
                  cell: (v: (typeof detalle.ventas)[number]) =>
                    v.estado === "CONFIRMADA" ? (
                      <Link
                        href={rutaPanel(slug, `/devoluciones?nueva=1&ventaId=${v.id}`)}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        <Undo2 strokeWidth={1.75} /> Garantía
                      </Link>
                    ) : null,
                },
              ]
            : []),
        ]}
        renderMobile={(v) => {
          const contenido = (
            <>
              <div className="flex justify-between gap-2">
                <span className="font-semibold tabular-nums">{v.codigo}</span>
                <span className="font-semibold tabular-nums">{formatearPesos(v.total)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted text-xs">
                  {formatearFechaHora(v.fecha)} · {MEDIO_PAGO_LABEL[v.medioPago]}
                </span>
                <Badge variant={ESTADO_VENTA_CLIENTE[v.estado].variante}>
                  {ESTADO_VENTA_CLIENTE[v.estado].label}
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

      <div className="mt-6 mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Devoluciones</h2>
        {crearDevolucion && (
          <Link
            href={rutaPanel(slug, `/devoluciones?nueva=1&clienteId=${c.id}`)}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <Undo2 strokeWidth={1.75} /> Registrar devolución
          </Link>
        )}
      </div>
      <DataTable
        caption="Devoluciones del cliente"
        rows={detalle.devoluciones}
        getRowKey={(d) => d.id}
        empty={<EmptyState icon={Undo2} title="Sin devoluciones" />}
        columns={[
          {
            key: "codigo",
            header: "ID",
            cell: (d) =>
              verDevoluciones ? (
                <Link
                  href={hrefDevolucion(d.id)}
                  className="text-primary font-semibold tabular-nums hover:underline"
                >
                  {d.codigo}
                </Link>
              ) : (
                <span className="tabular-nums">{d.codigo}</span>
              ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (d) => <span className="text-muted">{formatearFechaHora(d.fecha)}</span>,
          },
          {
            key: "productos",
            header: "Producto(s)",
            cell: (d) => d.productos.map((p) => `${p.cantidad} × ${p.titulo}`).join(", "),
          },
          { key: "galpon", header: "Galpón", cell: (d) => d.deposito },
          {
            key: "estado",
            header: "Estado",
            cell: (d) => (
              <Badge variant={ESTADO_DEVOLUCION_UI[d.estado].variante}>
                {ESTADO_DEVOLUCION_UI[d.estado].label}
              </Badge>
            ),
          },
        ]}
        renderMobile={(d) => {
          const contenido = (
            <>
              <div className="flex justify-between gap-2">
                <span className="font-semibold tabular-nums">{d.codigo}</span>
                <Badge variant={ESTADO_DEVOLUCION_UI[d.estado].variante}>
                  {ESTADO_DEVOLUCION_UI[d.estado].label}
                </Badge>
              </div>
              <p className="mt-1 text-sm">
                {d.productos.map((p) => `${p.cantidad} × ${p.titulo}`).join(", ")}
              </p>
              <p className="text-muted mt-1 text-xs">
                {formatearFechaHora(d.fecha)} · {d.deposito}
              </p>
            </>
          );
          const clase = "border-border bg-surface block rounded-2xl border p-4";
          return verDevoluciones ? (
            <Link href={hrefDevolucion(d.id)} className={clase}>
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
