"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ChartPlaceholder, ChartTheme, colorSerie } from "@/components/ui/chart-theme";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Orden fijo: Efectivo, Transferencia, Binance (el color sigue al medio, no al ranking):
 * azul, azul claro, naranja. La leyenda usa los mismos tokens (--serie-N). */
const COLORES = [colorSerie(0), colorSerie(1), colorSerie(2)];
const PUNTO = ["bg-serie-1", "bg-serie-2", "bg-serie-3"];

export interface SegmentoDonut {
  etiqueta: string;
  cantidad: number;
  total: number;
}

export function DonutMedios({ datos }: { datos: SegmentoDonut[] }) {
  const total = datos.reduce((a, d) => a + d.total, 0);
  // Un medio puede quedar negativo (se devolvió más diferencia de devoluciones
  // de la que entró): la torta solo dibuja lo positivo; la leyenda, el real.
  const porciones = datos.map((d) => ({ ...d, total: Math.max(0, d.total) }));
  if (!(total > 0)) {
    return <ChartPlaceholder mensaje="Todavía no hay ventas en este período" className="h-56" />;
  }
  return (
    // Contenedor: con lugar (≥ 28rem) el donut va a la izquierda y la leyenda a la derecha.
    <div className="@container">
      <div className="flex flex-col items-center gap-6 @md:flex-row @md:gap-8">
        <div className="relative size-48 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={porciones}
                dataKey="total"
                nameKey="etiqueta"
                innerRadius="68%"
                outerRadius="100%"
                paddingAngle={porciones.filter((d) => d.total > 0).length > 1 ? 2 : 0}
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
            <span className="text-h3 font-bold tabular-nums">{formatearPesos(total)}</span>
          </div>
        </div>
        <ul className="text-small divide-border flex w-full min-w-0 flex-col divide-y">
          {datos.map((d, i) => (
            <li key={d.etiqueta} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
              <span
                className={cn("rounded-circle mt-1 size-2.5 shrink-0", PUNTO[i % PUNTO.length])}
                aria-hidden
              />
              <span className="text-muted min-w-0 flex-1 truncate">{d.etiqueta}</span>
              <span className="flex flex-col items-end">
                <span className="font-semibold whitespace-nowrap tabular-nums">
                  {formatearPesos(d.total)}
                </span>
                <span className="text-subtle text-xs whitespace-nowrap tabular-nums">
                  {total > 0 ? `${Math.round((d.total / total) * 100)} %` : "—"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
