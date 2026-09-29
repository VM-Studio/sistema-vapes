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

import { ChartPlaceholder } from "@/components/ui/chart-theme";
import { formatearCompacto, formatearNumero, formatearPesos } from "@/lib/format";

export interface PuntoBarra {
  etiqueta: string;
  valor: number;
  /** Serie de comparación (opcional, gris). */
  comparacion?: number | null;
}

/** Barras simples (recharts). `moneda`: ejes y tooltip en pesos. */
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
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={horizontal}
            horizontal={!horizontal}
          />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tickFormatter={(n: number) => formatearCompacto(n, moneda)}
                fontSize={11}
                stroke="var(--color-muted)"
              />
              <YAxis
                type="category"
                dataKey="etiqueta"
                width={140}
                fontSize={11}
                stroke="var(--color-muted)"
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="etiqueta"
                fontSize={11}
                stroke="var(--color-muted)"
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(n: number) => formatearCompacto(n, moneda)}
                fontSize={11}
                width={56}
                stroke="var(--color-muted)"
              />
            </>
          )}
          <Tooltip formatter={(v) => fmt(Number(v))} cursor={{ fill: "var(--color-surface-2)" }} />
          {nombreComparacion && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {nombreComparacion && (
            <Bar
              dataKey="comparacion"
              name={nombreComparacion}
              fill="var(--color-dato-anterior)"
              radius={4}
            />
          )}
          <Bar dataKey="valor" name={nombre} fill="var(--color-dato-actual)" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
