import { Modulo } from "@prisma/client";
import { Boxes } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero } from "@/lib/format";
import { ESTADO_STOCK_UI } from "@/lib/movimientos-ui";
import { cn } from "@/lib/utils";
import { saborVisible } from "@/lib/ventas-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { filtrosStockSchema } from "@/server/reportes/filtros";
import { reporteStock } from "@/server/services/reporte.service";

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
      <div className="mb-5 grid grid-cols-1 gap-2 md:grid-cols-4">
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
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
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
      </div>
      {s.filas.length === 0 ? (
        <EmptyState icon={Boxes} title="No hay sabores con estos filtros" />
      ) : (
        <div className="border-border bg-surface overflow-x-auto rounded-card border">
          <table className="w-full text-sm" data-testid="matriz-stock">
            <thead className="bg-surface-2 text-muted text-left text-xs">
              <tr>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 font-medium">Sabor</th>
                {s.depositos.map((d) => (
                  <th key={d.id} className="px-4 py-3 text-right font-medium whitespace-nowrap">
                    {d.nombre}
                  </th>
                ))}
                {variosDepositos && <th className="px-4 py-3 text-right font-medium">Total</th>}
                <th className="px-4 py-3 text-right font-medium">Mínimo</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {s.filas.map((x, i) => {
                const nuevoProducto = i === 0 || s.filas[i - 1]!.producto !== x.producto;
                return (
                  <tr
                    key={x.varianteId}
                    className={cn("border-border", nuevoProducto && "border-t")}
                  >
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {nuevoProducto ? x.producto : ""}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {saborVisible(x.sabor) ?? <span className="text-muted">—</span>}
                    </td>
                    {s.depositos.map((d) => (
                      <td key={d.id} className="px-4 py-2.5 text-right tabular-nums">
                        {x.porDeposito[d.id] ?? 0}
                      </td>
                    ))}
                    {variosDepositos && (
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {x.total}
                      </td>
                    )}
                    <td className="text-muted px-4 py-2.5 text-right tabular-nums">{x.minimo}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={ESTADO_STOCK_UI[x.estado].variante}>
                        {ESTADO_STOCK_UI[x.estado].label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
