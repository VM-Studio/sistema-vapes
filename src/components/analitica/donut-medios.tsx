"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ChartPlaceholder, ChartTheme, colorSerie } from "@/components/ui/chart-theme";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Orden fijo: Efectivo, Transferencia, Binance (el color sigue al medio, no al ranking):
 * azul, azul claro, naranja. La leyenda usa los mismos tokens (--serie-N). */
const COLORES = [colorSerie(0), colorSerie(1), colorSerie(2)];
const CUADRADITO = ["bg-serie-1", "bg-serie-2", "bg-serie-3"];

export interface SegmentoDonut {
  etiqueta: string;
  cantidad: number;
  total: number;
}

export function DonutMedios({ datos }: { datos: SegmentoDonut[] }) {
  const total = datos.reduce((a, d) => a + d.total, 0);
  if (!(total > 0)) {
    return <ChartPlaceholder mensaje="Sin ventas en el período" className="h-56" />;
  }
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative size-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={datos}
              dataKey="total"
              nameKey="etiqueta"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={datos.filter((d) => d.total > 0).length > 1 ? 2 : 0}
              stroke="var(--card)"
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
          <span className="text-muted text-small">Total</span>
          <span className="text-h3 font-semibold tabular-nums">{formatearPesos(total)}</span>
        </div>
      </div>
      <ul className="text-small flex w-full flex-col gap-2.5">
        {datos.map((d, i) => (
          <li key={d.etiqueta} className="flex items-center gap-2.5">
            <span
              className={cn("h-2.5 w-3.5 shrink-0", CUADRADITO[i % CUADRADITO.length])}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{d.etiqueta}</span>
            <span className="text-subtle w-10 text-right whitespace-nowrap tabular-nums">
              {total > 0 ? `${Math.round((d.total / total) * 100)} %` : "—"}
            </span>
            <span className="min-w-24 text-right font-medium whitespace-nowrap tabular-nums">
              {formatearPesos(d.total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
