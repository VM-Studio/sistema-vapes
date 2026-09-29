"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { ChartPlaceholder, ChartTheme, ChartTooltipCard } from "@/components/ui/chart-theme";
import { formatearCompacto, formatearPesos } from "@/lib/format";

export interface PuntoGrafico {
  etiqueta: string;
  actual: number | null;
  anterior: number | null;
  fechaActual: string | null;
  fechaAnterior: string | null;
}

const ACTUAL = ChartTheme.actual;
const ANTERIOR = ChartTheme.anterior;

function Contenido({
  active,
  payload,
}: Partial<Pick<TooltipContentProps<number, string>, "active" | "payload">>) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as PuntoGrafico;
  const dif = p.actual !== null && p.anterior !== null ? p.actual - p.anterior : null;
  return (
    <ChartTooltipCard>
      <p className="mb-1.5 font-semibold">{p.etiqueta}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
        <dt className="text-muted flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: ACTUAL }} />
          Actual{p.fechaActual ? ` (${p.fechaActual})` : ""}
        </dt>
        <dd className="text-right font-medium">
          {p.actual === null ? "—" : formatearPesos(p.actual)}
        </dd>
        <dt className="text-muted flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-3 rounded border-t-2 border-dashed"
            style={{ borderColor: ANTERIOR }}
          />
          Anterior{p.fechaAnterior ? ` (${p.fechaAnterior})` : ""}
        </dt>
        <dd className="text-right font-medium">
          {p.anterior === null ? "—" : formatearPesos(p.anterior)}
        </dd>
        {dif !== null && (
          <>
            <dt className="text-muted">Diferencia</dt>
            <dd
              className={"text-right font-semibold"}
              style={{ color: dif > 0 ? ChartTheme.sube : dif < 0 ? ChartTheme.baja : undefined }}
            >
              {dif > 0 ? "+" : dif < 0 ? "−" : ""}
              {formatearPesos(Math.abs(dif))}
            </dd>
          </>
        )}
      </dl>
    </ChartTooltipCard>
  );
}

/** Facturado del período actual (azul) contra el anterior (naranja punteado). */
export function GraficoComparativo({ datos }: { datos: PuntoGrafico[] }) {
  if (!datos.some((p) => p.actual || p.anterior)) {
    return (
      <div data-testid="grafico-comparativo">
        <ChartPlaceholder mensaje="Sin ventas en el período" />
      </div>
    );
  }
  return (
    <div className="h-64 w-full md:h-80" data-testid="grafico-comparativo">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...ChartTheme.grid} />
          <XAxis
            dataKey="etiqueta"
            tickLine={false}
            axisLine={ChartTheme.ejeX.axisLine}
            tick={ChartTheme.ejeX.tick}
            minTickGap={12}
            interval="preserveStartEnd"
          />
          <YAxis
            width={68}
            tickLine={false}
            axisLine={false}
            tick={ChartTheme.ejeX.tick}
            tickFormatter={(v: number) => formatearCompacto(v, true)}
          />
          <Tooltip
            content={(props) => (
              <Contenido active={props.active} payload={props.payload as never} />
            )}
            cursor={{ stroke: ChartTheme.cursor, strokeWidth: 1 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="plainline"
            wrapperStyle={ChartTheme.leyenda}
          />
          <Line
            name="Anterior"
            type="monotone"
            dataKey="anterior"
            stroke={ANTERIOR}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            name="Actual"
            type="monotone"
            dataKey="actual"
            stroke={ACTUAL}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, stroke: "var(--background)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
