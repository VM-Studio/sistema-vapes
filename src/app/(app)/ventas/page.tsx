import { Modulo } from "@prisma/client";
import { Plus, ShoppingCart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { esFechaISO, fechasDeRango, RANGOS, type Rango } from "@/lib/fechas";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { esOwner, puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { listarVentasSchema } from "@/lib/validations/venta";
import { ESTADO_PAGO_UI, ESTADO_VENTA_UI } from "@/lib/ventas-ui";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarDepositos } from "@/server/services/deposito.service";
import { listarUsuariosBasico } from "@/server/services/usuario.service";
import { listarVentas, type VentaListada } from "@/server/services/venta.service";

import { FiltrosVentas } from "./filtros-ventas";
import { VentasTabs } from "./ventas-tabs";

export const metadata: Metadata = { title: "Ventas" };

type SP = Record<string, string | string[] | undefined>;

export default async function VentasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const usuario = await requirePaginaPermiso(Modulo.VENTAS, "ver");
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const rango = RANGOS.includes(plano.rango as Rango) ? (plano.rango as Rango) : null;
  const fechas = rango
    ? fechasDeRango(rango)
    : { desde: plano.desde ?? "", hasta: plano.hasta ?? "" };
  const filtros = listarVentasSchema.parse({ ...plano, desde: fechas.desde, hasta: fechas.hasta });
  const [r, depositos, vendedores] = await Promise.all([
    listarVentas(filtros),
    listarDepositos(),
    listarUsuariosBasico(),
  ]);
  const verGanancia = esOwner(usuario);
  const borradores = filtros.estado === "BORRADOR";

  const href = (v: VentaListada) =>
    v.estado === "BORRADOR" ? `/ventas/nueva?borrador=${v.id}` : `/ventas/${v.id}`;
  const badges = (v: VentaListada) => (
    <span className="flex flex-wrap gap-1">
      <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>{ESTADO_VENTA_UI[v.estado].label}</Badge>
      {v.estado === "CONFIRMADA" && v.estadoPago !== "PAGADA" && (
        <Badge variant={ESTADO_PAGO_UI[v.estadoPago].variante}>
          {ESTADO_PAGO_UI[v.estadoPago].label}
        </Badge>
      )}
    </span>
  );

  return (
    <>
      <VentasTabs usuario={usuario} actual={borradores ? "borradores" : "listado"} />
      <PageHeader
        title={borradores ? "Borradores" : "Ventas"}
        subtitle={
          borradores
            ? "Presupuestos y ventas sin cobrar: tocá uno para retomarlo en el punto de venta."
            : undefined
        }
        actions={
          puede(usuario, Modulo.VENTAS, "crear") && (
            <Link href="/ventas/nueva" className={buttonVariants()}>
              <Plus /> Nueva venta
            </Link>
          )
        }
      />
      <FiltrosVentas
        params={plano}
        rango={rango}
        fechas={{
          desde: esFechaISO(fechas.desde) ? fechas.desde : "",
          hasta: esFechaISO(fechas.hasta) ? fechas.hasta : "",
        }}
        depositos={depositos.map((d) => ({ id: d.id, nombre: d.nombre }))}
        vendedores={vendedores.map((u) => ({ id: u.id, nombre: u.nombre }))}
      />
      {!borradores && (
        <section
          aria-label="Totales del rango"
          className={`mb-4 grid gap-3 ${verGanancia ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <StatCard label="Ventas confirmadas" value={formatearNumero(r.resumen.cantidad)} />
          <StatCard label="Total vendido" value={formatearPesos(r.resumen.total)} />
          {verGanancia && (
            <StatCard label="Ganancia bruta" value={formatearPesos(r.resumen.gananciaBruta)} />
          )}
        </section>
      )}
      <DataTable
        caption="Ventas"
        rows={r.ventas}
        getRowKey={(v) => v.id}
        empty={
          <EmptyState
            icon={ShoppingCart}
            title={borradores ? "No hay borradores" : "No hay ventas con esos filtros"}
          />
        }
        columns={[
          {
            key: "numero",
            header: "N.º",
            cell: (v) => (
              <Link href={href(v)} className="text-primary font-semibold hover:underline">
                #{v.numero}
              </Link>
            ),
          },
          {
            key: "fecha",
            header: "Fecha",
            cell: (v) => <span className="text-muted">{formatearFechaHora(v.fecha)}</span>,
          },
          {
            key: "cliente",
            header: "Cliente",
            cell: (v) => v.cliente ?? <span className="text-muted">—</span>,
          },
          { key: "vendedor", header: "Vendedor", cell: (v) => v.vendedor },
          { key: "deposito", header: "Depósito", cell: (v) => v.deposito },
          {
            key: "items",
            header: "Ítems",
            className: "text-right tabular-nums",
            cell: (v) => `${v.items} (${v.unidades} u.)`,
          },
          {
            key: "total",
            header: "Total",
            className: "text-right tabular-nums font-medium",
            cell: (v) => formatearPesos(v.total),
          },
          { key: "estado", header: "Estado", cell: badges },
        ]}
        renderMobile={(v) => (
          <Link href={href(v)} className="border-border bg-surface block rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                #{v.numero}
                {v.cliente && <span className="text-muted font-normal"> · {v.cliente}</span>}
              </span>
              <span className="font-semibold tabular-nums">{formatearPesos(v.total)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-muted text-xs">
                {formatearFechaHora(v.fecha)} · {v.vendedor} · {v.unidades} u.
              </p>
              {badges(v)}
            </div>
          </Link>
        )}
      />
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname="/ventas"
        params={plano}
      />
    </>
  );
}
