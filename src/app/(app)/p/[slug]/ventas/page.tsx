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
import { formatearIdVenta, rutaPanel } from "@/lib/paneles";
import { esOwner, puede } from "@/lib/permisos";
import { formatearFechaHora } from "@/lib/utils";
import { listarVentasSchema } from "@/lib/validations/venta";
import { ESTADO_VENTA_UI, ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import {
  listarVentas,
  vendedoresDelPanel,
  type VentaListada,
} from "@/server/services/venta.service";

import { FiltrosVentas } from "./filtros-ventas";
import { VentasTabs } from "./ventas-tabs";

export const metadata: Metadata = { title: "Ventas" };

type SP = Record<string, string | string[] | undefined>;

export default async function VentasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanel(Modulo.VENTAS, "ver");
  const { slug } = ctx.panel;
  const plano = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const rango = RANGOS.includes(plano.rango as Rango) ? (plano.rango as Rango) : null;
  const fechas = rango
    ? fechasDeRango(rango)
    : { desde: plano.desde ?? "", hasta: plano.hasta ?? "" };
  const filtros = listarVentasSchema.parse({ ...plano, desde: fechas.desde, hasta: fechas.hasta });
  const verGanancia = esOwner(ctx.usuario);
  const [r, depositos, vendedores] = await Promise.all([
    listarVentas(ctx, filtros, { verCostos: verGanancia }),
    listarDepositosActivos(ctx),
    vendedoresDelPanel(ctx),
  ]);
  const borradores = filtros.estado === "BORRADOR";

  const href = (v: VentaListada) =>
    rutaPanel(slug, v.estado === "BORRADOR" ? `/ventas/nueva?borrador=${v.id}` : `/ventas/${v.id}`);
  const badge = (v: VentaListada) => (
    <Badge variant={ESTADO_VENTA_UI[v.estado].variante}>{ESTADO_VENTA_UI[v.estado].label}</Badge>
  );

  return (
    <>
      <VentasTabs ctx={ctx} actual={borradores ? "borradores" : "listado"} />
      <PageHeader
        title={borradores ? "Borradores" : "Ventas"}
        subtitle={
          borradores
            ? "Presupuestos y ventas sin cobrar: tocá uno para retomarlo en el punto de venta."
            : undefined
        }
        actions={
          puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "crear") && (
            <Link href={rutaPanel(slug, "/ventas/nueva")} className={buttonVariants()}>
              <Plus strokeWidth={1.75} /> Nueva venta
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
        vendedores={vendedores}
      />
      {!borradores && (
        <section
          aria-label="Totales del rango"
          className={`mb-4 grid gap-3 ${r.resumen.gananciaBruta !== null ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <StatCard label="Ventas confirmadas" value={formatearNumero(r.resumen.cantidad)} />
          <StatCard label="Total vendido" value={formatearPesos(r.resumen.total)} />
          {r.resumen.gananciaBruta !== null && (
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
            header: "ID",
            cell: (v) => (
              <Link
                href={href(v)}
                className="text-primary font-semibold tabular-nums hover:underline"
              >
                {formatearIdVenta(slug, v.numero)}
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
            key: "medio",
            header: "Pago",
            cell: (v) =>
              v.medioPago ? (
                ETIQUETA_MEDIO_PAGO[v.medioPago]
              ) : (
                <span className="text-muted">—</span>
              ),
          },
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
          { key: "estado", header: "Estado", cell: badge },
        ]}
        renderMobile={(v) => (
          <Link href={href(v)} className="border-border bg-surface block rounded-2xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold tabular-nums">
                {formatearIdVenta(slug, v.numero)}
                {v.cliente && <span className="text-muted font-normal"> · {v.cliente}</span>}
              </span>
              <span className="font-semibold tabular-nums">{formatearPesos(v.total)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-muted text-xs">
                {formatearFechaHora(v.fecha)} · {v.vendedor} · {v.unidades} u.
                {v.medioPago && ` · ${ETIQUETA_MEDIO_PAGO[v.medioPago]}`}
              </p>
              {badge(v)}
            </div>
          </Link>
        )}
      />
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname={rutaPanel(slug, "/ventas")}
        params={plano}
      />
    </>
  );
}
