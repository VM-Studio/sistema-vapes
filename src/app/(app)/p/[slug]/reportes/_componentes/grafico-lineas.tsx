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

import { ChartPlaceholder, ChartTheme } from "@/components/ui/chart-theme";
import { formatearCompacto, formatearPesos } from "@/lib/format";

const COLORES = ChartTheme.escala;

/** Una línea por serie (ej. un proveedor), puntos con fecha "dd/mm/aa". */
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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="fecha" fontSize={11} stroke="var(--color-muted)" />
          <YAxis
            tickFormatter={(n: number) => formatearCompacto(n, true)}
            fontSize={11}
            width={56}
            stroke="var(--color-muted)"
          />
          <Tooltip formatter={(v) => formatearPesos(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Line
              key={s.clave}
              type="stepAfter"
              dataKey={s.clave}
              name={s.nombre}
              stroke={COLORES[i % COLORES.length]}
              strokeWidth={2}
              dot
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
