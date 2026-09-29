import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import Link from "next/link";

import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { rutaPanel } from "@/lib/paneles";
import { cn } from "@/lib/utils";
import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import {
  periodoDesdeParams,
  queryPeriodo,
  rendimientoVendedores,
  type RendimientoVendedor,
} from "@/server/services/analitica.service";

import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { GraficoBarras } from "../_componentes/grafico-barras";
import { PeriodoAnalitica } from "../_componentes/periodo-analitica";

export const metadata: Metadata = { title: "Rendimiento por vendedor" };

type SP = Record<string, string | string[] | undefined>;

/** Rendimiento por vendedor (SOLO dueños): tabla completa + gráfico de facturado. */
export default async function VendedoresPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePaginaPanelOwner();
  const sp = await searchParams;
  const plano = Object.fromEntries(
    Object.entries(sp).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const periodo = periodoDesdeParams(sp);
  const filas = await rendimientoVendedores(ctx, periodo);
  const detalle = (id: string) => rutaPanel(ctx.panel.slug, `/equipo/${id}${queryPeriodo(sp)}`);
  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="vendedores"
        titulo="Rendimiento por vendedor"
        subtitulo="Ventas, cotizaciones convertidas y comisión orientativa de cada usuario."
        params={plano}
      />
      <PeriodoAnalitica periodo={periodo} preset={plano.preset ?? null} />
      <div className="flex flex-col gap-4">
        <SectionCard title="Facturado por vendedor">
          <GraficoBarras
            horizontal
            moneda
            nombre="Facturado"
            datos={filas
              .filter((f) => f.cantidadVentas > 0)
              .map((f) => ({ etiqueta: f.nombre, valor: Number(f.facturado) }))}
          />
        </SectionCard>
        <SectionCard title="Detalle por vendedor">
          <DataTable
            caption="Rendimiento por vendedor"
            rows={filas}
            getRowKey={(r) => r.usuarioId}
            empty={
              <EmptyState icon={UsersRound} title="No hay vendedores con acceso a este panel" />
            }
            columns={[
              {
                key: "nombre",
                header: "Vendedor",
                cell: (r: RendimientoVendedor) => (
                  <Link
                    href={detalle(r.usuarioId)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {r.nombre}
                  </Link>
                ),
              },
              {
                key: "ventas",
                header: "Ventas",
                className: "text-right tabular-nums",
                cell: (r) => formatearNumero(r.cantidadVentas),
              },
              {
                key: "unidades",
                header: "Unidades",
                className: "text-right tabular-nums",
                cell: (r) => formatearNumero(r.unidades),
              },
              {
                key: "facturado",
                header: "Facturado",
                className: "text-right tabular-nums font-medium",
                cell: (r) => formatearPesos(r.facturado),
              },
              {
                key: "unit",
                header: "Unitarias",
                className: "text-right tabular-nums",
                cell: (r) => `${r.unitarias.cantidad} · ${formatearPesos(r.unitarias.total)}`,
              },
              {
                key: "may",
                header: "Mayoristas",
                className: "text-right tabular-nums",
                cell: (r) => `${r.mayoristas.cantidad} · ${formatearPesos(r.mayoristas.total)}`,
              },
              {
                key: "ticket",
                header: "Ticket prom.",
                className: "text-right tabular-nums",
                cell: (r) => formatearPesos(r.ticketPromedio),
              },
              {
                key: "cot",
                header: "Cotizaciones",
                className: "text-right tabular-nums",
                cell: (r) => `${r.cotizaciones.convertidas}/${r.cotizaciones.creadas}`,
              },
              {
                key: "cli",
                header: "Clientes nuevos",
                className: "text-right tabular-nums",
                cell: (r) => formatearNumero(r.clientesNuevos),
              },
              {
                key: "dev",
                header: "Devol.",
                className: "text-right tabular-nums",
                cell: (r) => formatearNumero(r.devoluciones),
              },
              {
                key: "com",
                header: "Comisión est.",
                className: "text-right tabular-nums",
                cell: (r) => (r.comision ? formatearPesos(r.comision.estimada) : "—"),
              },
            ]}
            renderMobile={(r) => (
              <Link
                href={detalle(r.usuarioId)}
                className={cn(
                  cardVariants({ variant: "outline" }),
                  "hover:bg-surface-2 block p-4 transition-colors",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.nombre}</span>
                  <span className="font-semibold tabular-nums">{formatearPesos(r.facturado)}</span>
                </div>
                <p className="text-muted text-small mt-1">
                  {r.cantidadVentas} ventas · {r.unidades} u. · ticket{" "}
                  {formatearPesos(r.ticketPromedio)}
                  {r.comision ? ` · comisión ${formatearPesos(r.comision.estimada)}` : ""}
                </p>
              </Link>
            )}
          />
        </SectionCard>
      </div>
    </>
  );
}
