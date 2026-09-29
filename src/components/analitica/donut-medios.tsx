"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ChartPlaceholder, ChartTheme, colorSerie } from "@/components/ui/chart-theme";
import { formatearPesos } from "@/lib/format";

/** Orden fijo: Efectivo, Transferencia, Binance (el color sigue al medio, no al ranking). */
const COLORES = [colorSerie(0), colorSerie(2), colorSerie(1)];

export interface SegmentoDonut {
  etiqueta: string;
  cantidad: number;
  total: number;
}

export function DonutMedios({ datos }: { datos: SegmentoDonut[] }) {
  const total = datos.reduce((a, d) => a + d.total, 0);
  if (!(total > 0)) {
    return <ChartPlaceholder mensaje="Sin ventas en el período" className="h-44 md:h-52" />;
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative size-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={datos}
              dataKey="total"
              nameKey="etiqueta"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={datos.filter((d) => d.total > 0).length > 1 ? 2 : 0}
              stroke="#fff"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {datos.map((d, i) => (
                <Cell key={d.etiqueta} fill={COLORES[i % COLORES.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v) => formatearPesos(Number(v))}
              contentStyle={ChartTheme.tooltip}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-muted text-xs">Total</span>
          <span className="text-sm font-semibold tabular-nums">{formatearPesos(total)}</span>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-2 text-sm">
        {datos.map((d, i) => (
          <li key={d.etiqueta} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: COLORES[i % COLORES.length] }}
              aria-hidden
            />
            <span className="flex-1">{d.etiqueta}</span>
            <span className="text-muted whitespace-nowrap tabular-nums">
              {total > 0 ? `${Math.round((d.total / total) * 100)} %` : "—"}
            </span>
            <span className="min-w-20 text-right font-medium whitespace-nowrap tabular-nums">
              {formatearPesos(d.total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
