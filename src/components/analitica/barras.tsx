"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatearCompacto, formatearPesos } from "@/lib/format";

export interface Barra {
  etiqueta: string;
  valor: number;
  /** Texto secundario del tooltip ("12 ventas"). */
  detalle?: string;
}

/** Barras horizontales de una sola serie (acento del panel) con el valor al final. */
export function BarrasHorizontales({ datos, moneda = true }: { datos: Barra[]; moneda?: boolean }) {
  const fmt = (v: number) => (moneda ? formatearPesos(v) : String(v));
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
            tick={{ fontSize: 13, fill: "#111113" }}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            formatter={(v, _n, item) => [
              `${fmt(Number(v))}${(item.payload as Barra).detalle ? ` · ${(item.payload as Barra).detalle}` : ""}`,
              "",
            ]}
            separator=""
            contentStyle={{ borderRadius: 12, fontSize: 13 }}
          />
          <Bar
            dataKey="valor"
            fill="var(--panel-accent)"
            radius={[0, 4, 4, 0]}
            barSize={22}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="valor"
              position="right"
              formatter={(v) => (moneda ? formatearCompacto(Number(v), true) : String(v))}
              style={{ fontSize: 12, fill: "#5f5f6b" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
