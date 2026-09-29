import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { esOwner } from "@/lib/permisos";
import { formatearFecha } from "@/lib/utils";
import { telefonoVisible } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { rangoReporte } from "@/server/reportes/filtros";
import {
  DIAS_INACTIVO,
  reporteClientes,
  type ReporteClientes,
} from "@/server/services/reporte.service";

import { BarraFiltros, FilaMobile, GrillaKpis } from "../_componentes/barra-filtros";
import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { FiltroPeriodo } from "../_componentes/filtro-periodo";
import { GraficoBarras } from "../_componentes/grafico-barras";
import { paramsPlanos } from "../_componentes/params";

export const metadata: Metadata = { title: "Reporte de clientes" };

type Nuevo = ReporteClientes["nuevos"][number];
type Top = NonNullable<ReporteClientes["top"]>[number];
type Inactivo = ReporteClientes["inactivos"][number];

/** Reporte 8: clientes nuevos, mejores compradores (dueños) e inactivos > 60 días. */
export default async function ReporteClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanel(Modulo.REPORTES, "ver");
  const plano = await paramsPlanos(searchParams);
  const r = rangoReporte(plano);
  const c = await reporteClientes(ctx, r, { owner: esOwner(ctx.usuario) });
  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="clientes"
        titulo="Clientes"
        subtitulo={r.etiqueta}
        params={plano}
      />
      <BarraFiltros>
        <FiltroPeriodo periodo={r.periodo} desde={r.desde} hasta={r.hasta} />
      </BarraFiltros>
      <GrillaKpis>
        <StatCard
          label="Clientes nuevos"
          value={formatearNumero(c.nuevos.length)}
          hint={r.etiqueta}
        />
        <StatCard
          label={`Inactivos (+${DIAS_INACTIVO} días)`}
          value={formatearNumero(c.inactivos.length)}
          tono={c.inactivos.length ? "alerta" : "neutral"}
        />
      </GrillaKpis>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Altas por día">
          <GraficoBarras
            nombre="Clientes nuevos"
            datos={c.nuevosPorDia.map((d) => ({
              etiqueta: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`,
              valor: d.clientes,
            }))}
          />
        </SectionCard>
        <SectionCard title="Clientes nuevos">
          <DataTable
            caption="Clientes nuevos"
            rows={c.nuevos.slice(0, 100)}
            getRowKey={(x) => x.id}
            empty={<EmptyState title="No hubo clientes nuevos en el período" />}
            columns={[
              {
                key: "n",
                header: "Cliente",
                cell: (x: Nuevo) => <span className="font-medium">{x.nombre}</span>,
              },
              { key: "t", header: "Teléfono", cell: (x) => telefonoVisible(x.telefono) },
              {
                key: "a",
                header: "Alta",
                cell: (x) => <span className="text-muted">{formatearFecha(x.alta)}</span>,
              },
              {
                key: "c",
                header: "Compras",
                className: "text-right tabular-nums",
                cell: (x) => x.compras,
              },
            ]}
            renderMobile={(x) => (
              <FilaMobile className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{x.nombre}</span>
                  <span className="text-muted text-small block">
                    {telefonoVisible(x.telefono)} · alta {formatearFecha(x.alta)}
                  </span>
                </span>
                <span className="text-muted text-small shrink-0 tabular-nums">
                  {x.compras} compras
                </span>
              </FilaMobile>
            )}
          />
        </SectionCard>
      </div>
      {c.top && (
        <SectionCard className="mt-4" title="Mejores compradores del período">
          <DataTable
            caption="Mejores compradores"
            rows={c.top}
            getRowKey={(x) => x.id}
            empty={<EmptyState title="No hubo ventas en el período" />}
            columns={[
              {
                key: "n",
                header: "Cliente",
                cell: (x: Top) => <span className="font-medium">{x.nombre}</span>,
              },
              { key: "t", header: "Teléfono", cell: (x) => telefonoVisible(x.telefono) },
              {
                key: "c",
                header: "Compras",
                className: "text-right tabular-nums",
                cell: (x) => x.compras,
              },
              {
                key: "u",
                header: "Unidades",
                className: "text-right tabular-nums",
                cell: (x) => formatearNumero(x.unidades),
              },
              {
                key: "tot",
                header: "Total",
                className: "text-right tabular-nums font-medium",
                cell: (x) => formatearPesos(x.total),
              },
            ]}
            renderMobile={(x) => (
              <FilaMobile className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{x.nombre}</span>
                  <span className="text-muted text-small block">
                    {x.compras} compras · {formatearNumero(x.unidades)} u.
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatearPesos(x.total)}
                </span>
              </FilaMobile>
            )}
          />
        </SectionCard>
      )}
      <SectionCard className="mt-4" title={`Inactivos hace más de ${DIAS_INACTIVO} días`}>
        <DataTable
          caption="Clientes inactivos"
          rows={c.inactivos.slice(0, 200)}
          getRowKey={(x) => x.id}
          empty={<EmptyState title="No hay clientes inactivos" />}
          columns={[
            {
              key: "n",
              header: "Cliente",
              cell: (x: Inactivo) => <span className="font-medium">{x.nombre}</span>,
            },
            { key: "t", header: "Teléfono", cell: (x) => telefonoVisible(x.telefono) },
            { key: "u", header: "Última compra", cell: (x) => formatearFecha(x.ultimaCompra) },
            { key: "d", header: "Días", className: "text-right tabular-nums", cell: (x) => x.dias },
            {
              key: "c",
              header: "Compras",
              className: "text-right tabular-nums",
              cell: (x) => x.compras,
            },
          ]}
          renderMobile={(x) => (
            <FilaMobile className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{x.nombre}</span>
                <span className="text-muted text-small block">
                  {telefonoVisible(x.telefono)} · última {formatearFecha(x.ultimaCompra)}
                </span>
              </span>
              <span className="text-muted text-small shrink-0 tabular-nums">{x.dias} días</span>
            </FilaMobile>
          )}
        />
      </SectionCard>
    </>
  );
}
