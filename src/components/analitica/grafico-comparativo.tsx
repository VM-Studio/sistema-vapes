"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { ChartPlaceholder, ChartTheme, ChartTooltipCard } from "@/components/ui/chart-theme";
import { formatearCompacto, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

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
          <span className="bg-dato-actual inline-block size-2.5 shrink-0" aria-hidden />
          Actual{p.fechaActual ? ` (${p.fechaActual})` : ""}
        </dt>
        <dd className="text-right font-medium">
          {p.actual === null ? "—" : formatearPesos(p.actual)}
        </dd>
        <dt className="text-muted flex items-center gap-1.5">
          <span className="bg-dato-anterior inline-block size-2.5 shrink-0" aria-hidden />
          Anterior{p.fechaAnterior ? ` (${p.fechaAnterior})` : ""}
        </dt>
        <dd className="text-right font-medium">
          {p.anterior === null ? "—" : formatearPesos(p.anterior)}
        </dd>
        {dif !== null && (
          <>
            <dt className="text-muted border-border mt-1 border-t pt-1">Diferencia</dt>
            <dd
              className={cn(
                "border-border mt-1 border-t pt-1 text-right font-semibold",
                dif > 0 && "text-marca-azul",
                dif < 0 && "text-marca-naranja-oscuro",
              )}
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

/** Leyenda propia: punto azul (Actual) y trazo naranja punteado (Anterior). */
function Leyenda() {
  return (
    <ul className="text-muted text-small flex items-center justify-end gap-4" aria-hidden>
      <li className="flex items-center gap-1.5">
        <span className="bg-dato-actual rounded-circle inline-block size-2.5" />
        Actual
      </li>
      <li className="flex items-center gap-1.5">
        <span className="border-dato-anterior inline-block w-3.5 border-t-2 border-dashed" />
        Anterior
      </li>
    </ul>
  );
}

const ALTO = "h-[280px] md:h-[360px]";

/** Facturado del período actual (azul, con relleno) contra el anterior (naranja punteado). */
export function GraficoComparativo({ datos }: { datos: PuntoGrafico[] }) {
  if (!datos.some((p) => p.actual || p.anterior)) {
    return (
      <div data-testid="grafico-comparativo">
        <ChartPlaceholder mensaje="Todavía no hay ventas en este período" className={ALTO} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="grafico-comparativo">
      <Leyenda />
      <div className={cn("-ml-2 w-[calc(100%+0.5rem)]", ALTO)}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {/* Relleno en degradé bajo cada línea: color arriba, transparente abajo. */}
              <linearGradient id="relleno-actual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACTUAL} stopOpacity={0.22} />
                <stop offset="100%" stopColor={ACTUAL} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="relleno-anterior" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ANTERIOR} stopOpacity={0.14} />
                <stop offset="100%" stopColor={ANTERIOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...ChartTheme.grid} />
            <XAxis
              dataKey="etiqueta"
              tickLine={false}
              axisLine={false}
              tick={ChartTheme.ejeX.tick}
              tickMargin={8}
              minTickGap={12}
              interval="preserveStartEnd"
            />
            <YAxis
              width={60}
              {...ChartTheme.ejeY}
              tickFormatter={(v: number) => formatearCompacto(v, true)}
            />
            <Tooltip
              content={(props) => (
                <Contenido active={props.active} payload={props.payload as never} />
              )}
              cursor={{ stroke: ChartTheme.cursor, strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="anterior"
              stroke="none"
              fill="url(#relleno-anterior)"
              tooltipType="none"
              activeDot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="none"
              fill="url(#relleno-actual)"
              tooltipType="none"
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              name="Anterior"
              type="monotone"
              dataKey="anterior"
              stroke={ANTERIOR}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              name="Actual"
              type="monotone"
              dataKey="actual"
              stroke={ACTUAL}
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
