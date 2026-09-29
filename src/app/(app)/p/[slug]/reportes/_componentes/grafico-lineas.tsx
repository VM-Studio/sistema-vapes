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
} from "recharts";

import { ChartPlaceholder, ChartTheme, colorSerie } from "@/components/ui/chart-theme";
import { formatearCompacto, formatearPesos } from "@/lib/format";

/** Una línea por serie (ej. un proveedor, colores de la escala fija), puntos con fecha "dd/mm/aa". */
export function GraficoLineas({
  datos,
  series,
}: {
  datos: Record<string, string | number | null>[];
  series: { clave: string; nombre: string }[];
}) {
  const hayDatos = datos.some((d) =>
    series.some((s) => d[s.clave] !== null && d[s.clave] !== undefined && d[s.clave] !== 0),
  );
  if (!hayDatos)
    return <ChartPlaceholder mensaje="Sin datos para graficar" className="h-72 md:h-72" />;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid {...ChartTheme.grid} />
          <XAxis dataKey="fecha" {...ChartTheme.ejeX} />
          <YAxis
            tickFormatter={(n: number) => formatearCompacto(n, true)}
            width={56}
            {...ChartTheme.ejeY}
          />
          <Tooltip
            formatter={(v) => formatearPesos(Number(v))}
            contentStyle={ChartTheme.tooltip}
            cursor={{ stroke: ChartTheme.cursor }}
          />
          <Legend wrapperStyle={ChartTheme.leyenda} />
          {series.map((s, i) => (
            <Line
              key={s.clave}
              type="stepAfter"
              dataKey={s.clave}
              name={s.nombre}
              stroke={colorSerie(i)}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: colorSerie(i) }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
