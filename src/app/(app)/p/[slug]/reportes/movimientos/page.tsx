import { Modulo } from "@prisma/client";
import { ArrowLeftRight } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatearNumero } from "@/lib/format";
import { TIPO_MOVIMIENTO_UI, TIPOS_MOVIMIENTO_FILTRO } from "@/lib/movimientos-ui";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { filtrosMovimientosSchema, rangoReporte } from "@/server/reportes/filtros";
import {
  opcionesFiltros,
  reporteMovimientos,
  usuariosConMovimientos,
} from "@/server/services/reporte.service";

import { CabeceraReporte } from "../_componentes/cabecera-reporte";
import { FiltroPeriodo } from "../_componentes/filtro-periodo";
import { FiltroSelect } from "../_componentes/filtro-select";
import { GraficoBarras } from "../_componentes/grafico-barras";
import { paramsPlanos } from "../_componentes/params";

export const metadata: Metadata = { title: "Movimientos de stock" };

/** Reporte 6: movimientos de stock agregados por tipo, galpón y usuario. */
export default async function ReporteMovimientosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePaginaPanel(Modulo.REPORTES, "ver");
  const plano = await paramsPlanos(searchParams);
  const r = rangoReporte(plano);
  const f = filtrosMovimientosSchema.parse(plano);
  const [m, o, usuarios] = await Promise.all([
    reporteMovimientos(ctx, r, f),
    opcionesFiltros(ctx),
    usuariosConMovimientos(ctx),
  ]);
  type Fila = (typeof m.filas)[number];
  return (
    <>
      <CabeceraReporte
        slug={ctx.panel.slug}
        clave="movimientos"
        titulo="Movimientos de stock"
        subtitulo={r.etiqueta}
        params={plano}
      />
      <div className="mb-5 flex flex-col gap-3">
        <FiltroPeriodo periodo={r.periodo} desde={r.desde} hasta={r.hasta} />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <FiltroSelect
            param="tipo"
            valor={f.tipo}
            etiqueta="Tipo"
            todos="Todos los tipos"
            opciones={TIPOS_MOVIMIENTO_FILTRO.map((t) => ({
              value: t,
              label: TIPO_MOVIMIENTO_UI[t].label,
            }))}
          />
          <FiltroSelect
            param="depositoId"
            valor={f.depositoId}
            etiqueta="Galpón"
            todos="Todos los galpones"
            opciones={o.depositos.map((d) => ({ value: d.id, label: d.nombre }))}
          />
          <FiltroSelect
            param="usuarioId"
            valor={f.usuarioId}
            etiqueta="Usuario"
            todos="Todos los usuarios"
            opciones={usuarios.map((u) => ({ value: u.id, label: u.nombre }))}
          />
        </div>
      </div>
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Unidades por tipo</CardTitle>
        </CardHeader>
        <CardContent>
          <GraficoBarras
            horizontal
            nombre="Unidades"
            datos={m.porTipo.map((x) => ({
              etiqueta: TIPO_MOVIMIENTO_UI[x.tipo].label,
              valor: x.unidades,
            }))}
          />
        </CardContent>
      </Card>
      <DataTable
        caption="Movimientos por tipo, galpón y usuario"
        rows={m.filas}
        getRowKey={(x) => `${x.tipo}-${x.deposito}-${x.usuario}`}
        empty={<EmptyState icon={ArrowLeftRight} title="No hay movimientos con estos filtros" />}
        columns={[
          {
            key: "tipo",
            header: "Tipo",
            cell: (x: Fila) => (
              <Badge variant={TIPO_MOVIMIENTO_UI[x.tipo].variante}>
                {TIPO_MOVIMIENTO_UI[x.tipo].label}
              </Badge>
            ),
          },
          { key: "deposito", header: "Galpón", cell: (x) => x.deposito },
          { key: "usuario", header: "Usuario", cell: (x) => x.usuario },
          {
            key: "mov",
            header: "Movimientos",
            className: "text-right tabular-nums",
            cell: (x) => formatearNumero(x.movimientos),
          },
          {
            key: "u",
            header: "Unidades",
            className: "text-right tabular-nums font-medium",
            cell: (x) => formatearNumero(x.unidades),
          },
        ]}
        renderMobile={(x) => (
          <div className="border-border bg-surface flex items-center justify-between gap-2 rounded-card border p-4">
            <div className="flex flex-col gap-1">
              <Badge variant={TIPO_MOVIMIENTO_UI[x.tipo].variante} className="w-fit">
                {TIPO_MOVIMIENTO_UI[x.tipo].label}
              </Badge>
              <span className="text-muted text-xs">
                {x.deposito} · {x.usuario} · {x.movimientos} mov.
              </span>
            </div>
            <span className="font-semibold tabular-nums">{formatearNumero(x.unidades)} u.</span>
          </div>
        )}
      />
      <p className="text-muted mt-3 text-sm">
        Total: {formatearNumero(m.total.movimientos)} movimientos ·{" "}
        {formatearNumero(m.total.unidades)} unidades.
      </p>
    </>
  );
}
