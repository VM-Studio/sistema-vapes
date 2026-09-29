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

import { formatearCompacto, formatearPesos } from "@/lib/format";

export interface PuntoGrafico {
  etiqueta: string;
  actual: number | null;
  anterior: number | null;
  fechaActual: string | null;
  fechaAnterior: string | null;
}

const ACTUAL = "var(--panel-accent)";
const ANTERIOR = "#9a9aa5";

function Contenido({
  active,
  payload,
}: Partial<Pick<TooltipContentProps<number, string>, "active" | "payload">>) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as PuntoGrafico;
  const dif = p.actual !== null && p.anterior !== null ? p.actual - p.anterior : null;
  return (
    <div className="border-border bg-surface shadow-card-hover min-w-44 rounded-xl border p-3 text-sm">
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
              className={
                dif > 0
                  ? "text-success text-right font-semibold"
                  : dif < 0
                    ? "text-danger text-right font-semibold"
                    : "text-right font-semibold"
              }
            >
              {dif > 0 ? "+" : dif < 0 ? "−" : ""}
              {formatearPesos(Math.abs(dif))}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** Facturado del período actual (acento del panel) contra el anterior (gris punteado). */
export function GraficoComparativo({ datos }: { datos: PuntoGrafico[] }) {
  return (
    <div className="h-64 w-full md:h-80" data-testid="grafico-comparativo">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#ececf0" vertical={false} />
          <XAxis
            dataKey="etiqueta"
            tickLine={false}
            axisLine={{ stroke: "#e4e4e9" }}
            tick={{ fontSize: 12, fill: "#5f5f6b" }}
            minTickGap={12}
            interval="preserveStartEnd"
          />
          <YAxis
            width={68}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "#5f5f6b" }}
            tickFormatter={(v: number) => formatearCompacto(v, true)}
          />
          <Tooltip
            content={(props) => (
              <Contenido active={props.active} payload={props.payload as never} />
            )}
            cursor={{ stroke: "#c9c9d1", strokeWidth: 1 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="plainline"
            wrapperStyle={{ fontSize: 12 }}
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
            activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
