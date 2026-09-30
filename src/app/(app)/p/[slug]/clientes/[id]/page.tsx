import { Modulo } from "@prisma/client";
import { ShoppingCart, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ESTADO_DEVOLUCION_UI, ESTADO_VENTA_CLIENTE } from "@/components/clientes/etiquetas";
import { TelefonoWhatsApp } from "@/components/clientes/telefono-whatsapp";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFecha, formatearFechaHora } from "@/lib/utils";
import { etiquetaMedioPrincipal } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerCliente } from "@/server/services/cliente.service";

import { EstadoPagoBadge, MedioPagoBadge } from "../../ventas/_componentes/medio-pago";
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
  const verFiados = puedeEn(Modulo.FIADOS, "ver");
  const debe = Number(c.saldoDeudor) > 0;
  const hrefCuenta = rutaPanel(slug, `/fiados/${c.id}`);
  const tarjetas = 2 + (detalle.compras.total !== null ? 1 : 0) + (verFiados && debe ? 1 : 0);
  const hrefVenta = (ventaId: string) => rutaPanel(slug, `/ventas/${ventaId}`);
  const hrefDevolucion = (devId: string) => rutaPanel(slug, `/devoluciones/${devId}`);

  return (
    <>
      <PageHeader
        title={c.nombre}
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Clientes", href: rutaPanel(slug, "/clientes") }, { label: c.nombre }]}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {!c.activo && <Badge>Inactivo</Badge>}
            Cliente desde {formatearFecha(c.createdAt)}
          </span>
        }
        actions={
          puedeEn(Modulo.VENTAS, "crear") &&
          c.activo && (
            <Link
              href={rutaPanel(slug, `/ventas?nueva=1&cliente=${c.id}`)}
              className={buttonVariants()}
            >
              <ShoppingCart strokeWidth={1.75} /> Nueva venta
            </Link>
          )
        }
      />
      {!c.activo && (
        <p className="bg-warning-soft text-warning-soft-foreground rounded-card mb-4 px-4 py-3 text-sm">
          Cliente desactivado: no aparece en los buscadores. Sus ventas y devoluciones se conservan.
        </p>
      )}
      <section
        aria-label="Resumen de compras"
        className={cn(
          "mb-4 grid grid-cols-2 gap-3 md:gap-4",
          tarjetas >= 4 ? "md:grid-cols-4" : "md:grid-cols-3",
        )}
      >
        {verFiados && debe && (
          <StatCard
            label="Debe"
            value={formatearPesos(c.saldoDeudor)}
            hint="Ver cuenta corriente"
            href={hrefCuenta}
          />
        )}
        <StatCard label="Compras" value={String(detalle.compras.cantidad)} />
        {detalle.compras.total !== null && (
          <StatCard label="Total comprado" value={formatearPesos(detalle.compras.total)} />
        )}
        <StatCard
          label="Última compra"
          value={detalle.compras.ultima ? formatearFecha(detalle.compras.ultima) : "—"}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start">
        <SectionCard title="Datos">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <Avatar nombre={c.nombre} className="size-12 text-sm" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.nombre}</p>
                <TelefonoWhatsApp telefono={c.telefono} className="text-muted text-sm" />
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Cliente desde</dt>
              <dd className="text-right">{formatearFecha(c.createdAt)}</dd>
              <dt className="text-muted">Estado</dt>
              <dd className="text-right">{c.activo ? "Activo" : "Desactivado"}</dd>
              {verFiados && (
                <>
                  <dt className="text-muted">Cuenta corriente</dt>
                  <dd className="text-right">
                    <Link
                      href={hrefCuenta}
                      className="text-foreground font-medium underline-offset-4 hover:underline"
                    >
                      {debe ? `Debe ${formatearPesos(c.saldoDeudor)}` : "Al día"}
                    </Link>
                  </dd>
                </>
              )}
              {c.notas && (
                <>
                  <dt className="text-muted col-span-2">Notas</dt>
                  <dd className="col-span-2 whitespace-pre-line">{c.notas}</dd>
                </>
              )}
            </dl>
            <AccionesCliente
              cliente={{ id: c.id, nombre: c.nombre, telefono: c.telefono, notas: c.notas }}
              activo={c.activo}
              puedeEditar={puedeEn(Modulo.CLIENTES, "editar")}
              puedeEliminar={puedeEn(Modulo.CLIENTES, "eliminar")}
            />
          </div>
        </SectionCard>

        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title="Ventas" description="Historial de compras">
            <DataTable
              caption="Compras del cliente"
              rows={detalle.ventas}
              getRowKey={(v) => v.id}
              empty={
                <EmptyState
                  icon={ShoppingCart}
                  title="Todavía no compró"
                  className="bg-surface py-10 md:py-12"
                />
              }
              columns={[
                {
                  key: "codigo",
                  header: "ID",
                  cell: (v) =>
                    verVentas ? (
                      <Link
                        href={hrefVenta(v.id)}
                        className="text-foreground font-mono font-semibold hover:underline"
                      >
                        {v.codigo}
                      </Link>
                    ) : (
                      <span className="font-mono font-semibold">{v.codigo}</span>
                    ),
                },
                {
                  key: "fecha",
                  header: "Fecha",
                  cell: (v) => (
                    <span className="text-muted whitespace-nowrap">
                      {formatearFechaHora(v.fecha)}
                    </span>
                  ),
                },
                {
                  key: "medio",
                  header: "Pago",
                  cell: (v) => (
                    <span className="flex flex-wrap items-center gap-1">
                      <MedioPagoBadge medio={v.medioPago} />
                      {v.estado === "CONFIRMADA" && (
                        <EstadoPagoBadge estado={v.estadoPago} saldo={v.saldoPendiente} />
                      )}
                    </span>
                  ),
                },
                {
                  key: "total",
                  header: "Total",
                  className: "text-right tabular-nums",
                  cell: (v) => (
                    <span className="font-semibold whitespace-nowrap">
                      {formatearPesos(v.total)}
                    </span>
                  ),
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
                      <span className="font-mono font-semibold">{v.codigo}</span>
                      <span className="font-semibold tabular-nums">{formatearPesos(v.total)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-muted text-xs">
                        {formatearFechaHora(v.fecha)} · {etiquetaMedioPrincipal(v.medioPago)}
                      </span>
                      <span className="flex items-center gap-1">
                        {v.estado === "CONFIRMADA" && (
                          <EstadoPagoBadge estado={v.estadoPago} saldo={v.saldoPendiente} />
                        )}
                        <Badge variant={ESTADO_VENTA_CLIENTE[v.estado].variante}>
                          {ESTADO_VENTA_CLIENTE[v.estado].label}
                        </Badge>
                      </span>
                    </div>
                  </>
                );
                const clase =
                  "border-border bg-surface hover:bg-card block rounded-card border p-4";
                return verVentas ? (
                  <Link href={hrefVenta(v.id)} className={clase}>
                    {contenido}
                  </Link>
                ) : (
                  <div className={clase}>{contenido}</div>
                );
              }}
            />
          </SectionCard>

          <SectionCard
            title="Devoluciones"
            action={
              crearDevolucion && (
                <Link
                  href={rutaPanel(slug, `/devoluciones?nueva=1&clienteId=${c.id}`)}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  <Undo2 strokeWidth={1.75} /> Registrar devolución
                </Link>
              )
            }
          >
            <DataTable
              caption="Devoluciones del cliente"
              rows={detalle.devoluciones}
              getRowKey={(d) => d.id}
              empty={
                <EmptyState
                  icon={Undo2}
                  title="Sin devoluciones"
                  className="bg-surface py-10 md:py-12"
                />
              }
              columns={[
                {
                  key: "codigo",
                  header: "ID",
                  cell: (d) =>
                    verDevoluciones ? (
                      <Link
                        href={hrefDevolucion(d.id)}
                        className="text-foreground font-mono font-semibold whitespace-nowrap hover:underline"
                      >
                        {d.codigo}
                      </Link>
                    ) : (
                      <span className="font-mono font-semibold whitespace-nowrap">{d.codigo}</span>
                    ),
                },
                {
                  key: "fecha",
                  header: "Fecha",
                  cell: (d) => (
                    <span className="text-muted whitespace-nowrap">
                      {formatearFechaHora(d.fecha)}
                    </span>
                  ),
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
                      <span className="font-mono font-semibold">{d.codigo}</span>
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
                const clase =
                  "border-border bg-surface hover:bg-card block rounded-card border p-4";
                return verDevoluciones ? (
                  <Link href={hrefDevolucion(d.id)} className={clase}>
                    {contenido}
                  </Link>
                ) : (
                  <div className={clase}>{contenido}</div>
                );
              }}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}
