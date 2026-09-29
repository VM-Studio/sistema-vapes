"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartPlaceholder, ChartTheme } from "@/components/ui/chart-theme";
import { formatearCompacto, formatearPesos } from "@/lib/format";

export interface Barra {
  etiqueta: string;
  valor: number;
  /** Texto secundario del tooltip ("12 ventas"). */
  detalle?: string;
}

/** Barras horizontales de una sola serie (azul de marca) con el valor al final.
 * Sin valores (todo en 0 o vacío): placeholder, nunca barras vacías. */
export function BarrasHorizontales({ datos, moneda = true }: { datos: Barra[]; moneda?: boolean }) {
  const fmt = (v: number) => (moneda ? formatearPesos(v) : String(v));
  if (!datos.some((d) => d.valor)) {
    return <ChartPlaceholder mensaje="Sin datos en el período" className="h-40 md:h-44" />;
  }
  return (
    <div className="w-full" style={{ height: Math.max(96, datos.length * 52) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="etiqueta"
            width={96}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 13, fill: ChartTheme.textoFuerte }}
          />
          <Tooltip
            cursor={{ fill: ChartTheme.cursorArea }}
            formatter={(v, _n, item) => [
              `${fmt(Number(v))}${(item.payload as Barra).detalle ? ` · ${(item.payload as Barra).detalle}` : ""}`,
              "",
            ]}
            separator=""
            contentStyle={ChartTheme.tooltip}
          />
          <Bar
            dataKey="valor"
            fill={ChartTheme.actual}
            radius={[0, 4, 4, 0]}
            barSize={22}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="valor"
              position="right"
              formatter={(v) => (moneda ? formatearCompacto(Number(v), true) : String(v))}
              style={{ fontSize: 12, fill: ChartTheme.texto }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
