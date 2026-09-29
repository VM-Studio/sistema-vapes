import { Modulo } from "@prisma/client";
import { Boxes } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero } from "@/lib/format";
import { ESTADO_STOCK_UI } from "@/lib/movimientos-ui";
import { cn } from "@/lib/utils";
import { saborVisible } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { filtrosStockSchema } from "@/server/reportes/filtros";
import { reporteStock } from "@/server/services/reporte.service";

import { BarraFiltros, FilaMobile, GrillaKpis } from "../_componentes/barra-filtros";
import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { FiltroSelect } from "../_componentes/filtro-select";
import { paramsPlanos } from "../_componentes/params";

export const metadata: Metadata = { title: "Stock por galpón y sabor" };

/** Reporte 5: matriz producto × sabor × galpón con total, mínimo y estado (PDF apaisado). */
export default async function ReporteStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanel(Modulo.REPORTES, "ver");
  const plano = await paramsPlanos(searchParams);
  const f = filtrosStockSchema.parse(plano);
  const [s, todos] = await Promise.all([
    reporteStock(ctx, f),
    f.depositoId ? reporteStock(ctx, {}) : null,
  ]);
  const depositosFiltro = (todos ?? s).depositos;
  const variosDepositos = s.depositos.length > 1;

  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="stock"
        titulo="Stock por galpón y sabor"
        subtitulo="Lo que hay hoy en cada galpón, contra el mínimo de cada sabor."
        params={plano}
      />
      <BarraFiltros>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <SearchInput placeholder="Producto o sabor…" className="md:col-span-2" />
          <FiltroSelect
            param="depositoId"
            valor={f.depositoId}
            etiqueta="Galpón"
            todos="Todos los galpones"
            opciones={depositosFiltro.map((d) => ({ value: d.id, label: d.nombre }))}
          />
          <FiltroSelect
            param="estado"
            valor={f.estado}
            etiqueta="Estado"
            todos="Todos los estados"
            opciones={(["OK", "BAJO", "SIN_STOCK"] as const).map((e) => ({
              value: e,
              label: ESTADO_STOCK_UI[e].label,
            }))}
          />
        </div>
      </BarraFiltros>
      <GrillaKpis>
        {s.depositos.map((d) => (
          <StatCard
            key={d.id}
            label={d.nombre}
            value={formatearNumero(s.totales.porDeposito[d.id] ?? 0)}
            hint="unidades"
          />
        ))}
        {variosDepositos && (
          <StatCard label="Total" value={formatearNumero(s.totales.total)} hint="unidades" />
        )}
        <StatCard
          label="Bajo mínimo / sin stock"
          value={`${s.totales.bajo} / ${s.totales.sinStock}`}
          tono={s.totales.sinStock > 0 ? "alerta" : "neutral"}
        />
      </GrillaKpis>
      {s.filas.length === 0 ? (
        <EmptyState icon={Boxes} title="No hay sabores con estos filtros" />
      ) : (
        <SectionCard
          title="Stock por sabor"
          description={`${formatearNumero(s.filas.length)} ${s.filas.length === 1 ? "sabor" : "sabores"}`}
        >
          <div className="border-border bg-surface rounded-card hidden overflow-x-auto border md:block">
            <table className="w-full text-sm tabular-nums" data-testid="matriz-stock">
              <thead className="border-border bg-card text-muted border-b text-left text-xs">
                <tr>
                  <th scope="col" className="h-10 px-4 font-medium">
                    Producto
                  </th>
                  <th scope="col" className="h-10 px-4 font-medium">
                    Sabor
                  </th>
                  {s.depositos.map((d) => (
                    <th
                      key={d.id}
                      scope="col"
                      className="h-10 px-4 text-right font-medium whitespace-nowrap"
                    >
                      {d.nombre}
                    </th>
                  ))}
                  {variosDepositos && (
                    <th scope="col" className="h-10 px-4 text-right font-medium">
                      Total
                    </th>
                  )}
                  <th scope="col" className="h-10 px-4 text-right font-medium">
                    Mínimo
                  </th>
                  <th scope="col" className="h-10 px-4 font-medium">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.filas.map((x, i) => {
                  const nuevoProducto = i === 0 || s.filas[i - 1]!.producto !== x.producto;
                  return (
                    <tr
                      key={x.varianteId}
                      className={cn(
                        "border-border hover:bg-card/60 transition-colors",
                        nuevoProducto && i > 0 && "border-t",
                      )}
                    >
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                        {nuevoProducto ? x.producto : ""}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {saborVisible(x.sabor) ?? <span className="text-subtle">—</span>}
                      </td>
                      {s.depositos.map((d) => (
                        <td key={d.id} className="px-4 py-2.5 text-right">
                          {x.porDeposito[d.id] ?? 0}
                        </td>
                      ))}
                      {variosDepositos && (
                        <td className="px-4 py-2.5 text-right font-semibold">{x.total}</td>
                      )}
                      <td className="text-muted px-4 py-2.5 text-right">{x.minimo}</td>
                      <td className="px-4 py-2.5">
                        <BadgeEstado estado={x.estado} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Stock por sabor">
            {s.filas.map((x) => (
              <li key={x.varianteId}>
                <FilaMobile className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{x.producto}</span>
                      <span className="text-muted text-small block">
                        {saborVisible(x.sabor) ?? "Sin sabor"} · mínimo {x.minimo}
                      </span>
                    </span>
                    <BadgeEstado estado={x.estado} />
                  </div>
                  <dl className="text-small flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                    {s.depositos.map((d) => (
                      <div key={d.id} className="flex gap-1">
                        <dt className="text-muted">{d.nombre}</dt>
                        <dd className="font-medium">{x.porDeposito[d.id] ?? 0}</dd>
                      </div>
                    ))}
                    {variosDepositos && (
                      <div className="flex gap-1">
                        <dt className="text-muted">Total</dt>
                        <dd className="font-semibold">{x.total}</dd>
                      </div>
                    )}
                  </dl>
                </FilaMobile>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </>
  );
}

/** Estado del sabor: OK en neutro, bajo mínimo en alerta, sin stock en rojo. */
function BadgeEstado({ estado }: { estado: keyof typeof ESTADO_STOCK_UI }) {
  return (
    <Badge variant={estado === "OK" ? "neutral" : ESTADO_STOCK_UI[estado].variante}>
      {ESTADO_STOCK_UI[estado].label}
    </Badge>
  );
}
