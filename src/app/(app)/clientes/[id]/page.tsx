import { Modulo } from "@prisma/client";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { TabsNav } from "@/components/ui/tabs-nav";
import { formatearPesos } from "@/lib/format";
import { esOwner, puede } from "@/lib/permisos";
import { cn, formatearFecha, formatearFechaHora } from "@/lib/utils";
import { ESTADO_PAGO_UI, ESTADO_VENTA_UI } from "@/lib/ventas-ui";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { obtenerCliente, obtenerCuentaCorriente } from "@/server/services/cliente.service";

import { AccionesCliente } from "./acciones-cliente";

export const metadata: Metadata = { title: "Cliente" };

type SP = Record<string, string | string[] | undefined>;

export default async function ClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const usuario = await requirePaginaPermiso(Modulo.CLIENTES, "ver");
  const { id } = await params;
  const tab = (await searchParams).tab === "cuenta" ? "cuenta" : "resumen";
  const detalle = await obtenerCliente(id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const cuenta = await obtenerCuentaCorriente(id);
  const { cliente: c } = detalle;
  const verVentas = puede(usuario, Modulo.VENTAS, "ver");

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
            <Link href="/clientes" className={buttonVariants({ variant: "secondary" })}>
              <ArrowLeft /> Clientes
            </Link>
            {puede(usuario, Modulo.VENTAS, "crear") && c.activo && (
              <Link href={`/ventas/nueva?cliente=${c.id}`} className={buttonVariants()}>
                <ShoppingCart /> Nueva venta
              </Link>
            )}
          </>
        }
      />
      <section aria-label="Saldos" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Debe"
          value={
            <span className={cn(Number(c.saldoDeudor) > 0 && "text-danger")}>
              {formatearPesos(c.saldoDeudor)}
            </span>
          }
        />
        <StatCard
          label="A favor"
          value={
            <span className={cn(Number(c.saldoAFavor) > 0 && "text-success")}>
              {formatearPesos(c.saldoAFavor)}
            </span>
          }
        />
        <StatCard
          label="Límite de crédito"
          value={c.limiteCredito ? formatearPesos(c.limiteCredito) : "Sin fiado"}
        />
        <StatCard
          label="Compras"
          value={String(detalle.compras.cantidad)}
          hint={
            detalle.compras.ultima ? `última ${formatearFecha(detalle.compras.ultima)}` : undefined
          }
        />
      </section>

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
          limiteCredito: c.limiteCredito,
        }}
        saldoDeudor={c.saldoDeudor}
        pendientes={cuenta.pendientes}
        puedeEditar={puede(usuario, Modulo.CLIENTES, "editar")}
        puedeEliminar={puede(usuario, Modulo.CLIENTES, "eliminar")}
        puedeCobrar={puede(usuario, Modulo.VENTAS, "editar")}
        puedeDefinirLimite={esOwner(usuario)}
      />

      <TabsNav
        className="my-4"
        ariaLabel="Secciones del cliente"
        items={[
          { href: `/clientes/${c.id}`, label: "Compras", activo: tab === "resumen" },
          {
            href: `/clientes/${c.id}?tab=cuenta`,
            label: "Cuenta corriente",
            activo: tab === "cuenta",
          },
        ]}
      />

      {tab === "resumen" ? (
        <DataTable
          caption="Compras del cliente"
          rows={detalle.ventas}
          getRowKey={(v) => v.id}
          empty={<EmptyState icon={ShoppingCart} title="Todavía no compró" />}
          columns={[
            {
              key: "numero",
              header: "N.º",
              cell: (v) =>
                verVentas ? (
                  <Link
                    href={`/ventas/${v.id}`}
                    className="text-primary font-semibold hover:underline"
                  >
                    #{v.numero}
                  </Link>
                ) : (
                  `#${v.numero}`
                ),
            },
            {
              key: "fecha",
              header: "Fecha",
              cell: (v) => <span className="text-muted">{formatearFechaHora(v.fecha)}</span>,
            },
            {
              key: "total",
              header: "Total",
              className: "text-right tabular-nums",
              cell: (v) => formatearPesos(v.total),
            },
            {
              key: "saldo",
              header: "Pendiente",
              className: "text-right tabular-nums",
              cell: (v) =>
                Number(v.saldoPendiente) > 0 ? (
                  <span className="text-danger font-semibold">
                    {formatearPesos(v.saldoPendiente)}
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              key: "estado",
              header: "Estado",
              cell: (v) => (
                <span className="flex flex-wrap gap-1">
                  <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>
                    {ESTADO_VENTA_UI[v.estado].label}
                  </Badge>
                  {v.estado === "CONFIRMADA" && v.estadoPago !== "PAGADA" && (
                    <Badge variant={ESTADO_PAGO_UI[v.estadoPago].variante}>
                      {ESTADO_PAGO_UI[v.estadoPago].label}
                    </Badge>
                  )}
                  {v.devoluciones > 0 && <Badge variant="warning">{v.devoluciones} devol.</Badge>}
                </span>
              ),
            },
          ]}
          renderMobile={(v) => (
            <Link
              href={`/ventas/${v.id}`}
              className="border-border bg-surface block rounded-xl border p-4"
            >
              <div className="flex justify-between gap-2">
                <span className="font-semibold">#{v.numero}</span>
                <span className="font-semibold tabular-nums">{formatearPesos(v.total)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted text-xs">{formatearFechaHora(v.fecha)}</span>
                <span className="flex gap-1">
                  <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>
                    {ESTADO_VENTA_UI[v.estado].label}
                  </Badge>
                  {v.estado === "CONFIRMADA" && v.estadoPago !== "PAGADA" && (
                    <Badge variant={ESTADO_PAGO_UI[v.estadoPago].variante}>
                      {ESTADO_PAGO_UI[v.estadoPago].label}
                    </Badge>
                  )}
                </span>
              </div>
            </Link>
          )}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            {cuenta.movimientos.length === 0 ? (
              <EmptyState icon={ShoppingCart} title="Sin movimientos" className="border-0" />
            ) : (
              <ul aria-label="Cuenta corriente" className="divide-border divide-y">
                {cuenta.movimientos.map((m, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm md:grid-cols-[9rem_minmax(0,1fr)_7rem_7rem_7rem]"
                  >
                    <span className="text-muted text-xs md:text-sm">
                      {formatearFechaHora(m.fecha)}
                    </span>
                    <span className="col-span-2 min-w-0 truncate md:order-none md:col-span-1">
                      {verVentas ? (
                        <Link href={`/ventas/${m.ventaId}`} className="hover:underline">
                          {m.descripcion}
                        </Link>
                      ) : (
                        m.descripcion
                      )}
                    </span>
                    <span className="text-danger text-right tabular-nums">
                      {Number(m.debe) > 0 ? `+${formatearPesos(m.debe)}` : ""}
                    </span>
                    <span className="text-success text-right tabular-nums">
                      {Number(m.haber) > 0 ? `−${formatearPesos(m.haber)}` : ""}
                    </span>
                    <span className="col-span-2 text-right font-semibold tabular-nums md:col-span-1">
                      Saldo {formatearPesos(m.saldo)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
