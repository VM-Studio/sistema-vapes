"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartPlaceholder, ChartTheme } from "@/components/ui/chart-theme";
import { formatearCompacto, formatearNumero, formatearPesos } from "@/lib/format";

export interface PuntoBarra {
  etiqueta: string;
  valor: number;
  /** Serie de comparación (opcional, naranja: período anterior). */
  comparacion?: number | null;
}

/** Barras simples (recharts). Actual en azul, comparación en naranja. `moneda`: ejes y tooltip en pesos. */
export function GraficoBarras({
  datos,
  moneda = false,
  nombre = "Actual",
  nombreComparacion,
  horizontal = false,
  alto = 260,
}: {
  datos: PuntoBarra[];
  moneda?: boolean;
  nombre?: string;
  nombreComparacion?: string;
  horizontal?: boolean;
  alto?: number;
}) {
  const fmt = (n: number) => (moneda ? formatearPesos(n) : formatearNumero(n));
  if (!datos.some((d) => d.valor || d.comparacion)) {
    return <ChartPlaceholder mensaje="Sin datos para graficar" />;
  }
  const radio: [number, number, number, number] = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  return (
    <div
      style={{ height: horizontal ? Math.max(alto, datos.length * 34 + 40) : alto }}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={datos}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, bottom: 4, left: horizontal ? 8 : 0 }}
          barCategoryGap={horizontal ? 8 : "20%"}
        >
          <CartesianGrid
            stroke={ChartTheme.grilla}
            vertical={horizontal}
            horizontal={!horizontal}
          />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tickFormatter={(n: number) => formatearCompacto(n, moneda)}
                {...ChartTheme.ejeY}
              />
              <YAxis type="category" dataKey="etiqueta" width={132} {...ChartTheme.ejeX} />
            </>
          ) : (
            <>
              <XAxis dataKey="etiqueta" interval="preserveStartEnd" {...ChartTheme.ejeX} />
              <YAxis
                tickFormatter={(n: number) => formatearCompacto(n, moneda)}
                width={56}
                {...ChartTheme.ejeY}
              />
            </>
          )}
          <Tooltip
            formatter={(v) => fmt(Number(v))}
            contentStyle={ChartTheme.tooltip}
            cursor={{ fill: ChartTheme.cursorArea }}
          />
          {nombreComparacion && <Legend wrapperStyle={ChartTheme.leyenda} />}
          {nombreComparacion && (
            <Bar
              dataKey="comparacion"
              name={nombreComparacion}
              fill={ChartTheme.anterior}
              radius={radio}
              maxBarSize={28}
            />
          )}
          <Bar
            dataKey="valor"
            name={nombre}
            fill={ChartTheme.actual}
            radius={radio}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
