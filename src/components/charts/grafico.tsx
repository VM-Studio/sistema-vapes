"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { GraficoReporte } from "@/lib/reportes/documento";
import { formatearCompacto, formatearNumero, formatearPesos } from "@/lib/format";

/**
 * Gráficos (recharts). Colores por identidad con la paleta categórica
 * validada (--serie-1…6, orden fijo), una sola escala Y, grilla recesiva,
 * tooltip en hover y leyenda cuando hay 2 o más series. Altura fija: en el
 * celular ocupan todo el ancho sin saltar.
 */

const SERIES = [
  "var(--serie-1)",
  "var(--serie-2)",
  "var(--serie-3)",
  "var(--serie-4)",
  "var(--serie-5)",
  "var(--serie-6)",
];

const TICK = { fill: "var(--muted)", fontSize: 11 };

function valor(v: unknown, formato: GraficoReporte["formato"]) {
  const n = Number(v ?? 0);
  return formato === "moneda" ? formatearPesos(n) : formatearNumero(n);
}

function Tip({
  active,
  payload,
  label,
  formato,
}: {
  active?: boolean;
  payload?: { name?: string; value?: unknown; color?: string }[];
  label?: string | number;
  formato: GraficoReporte["formato"];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border bg-surface rounded-lg border px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <p className="text-muted mb-1 font-medium">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto font-semibold tabular-nums">{valor(p.value, formato)}</span>
        </p>
      ))}
    </div>
  );
}

/** Etiqueta del eje de categorías en UNA línea (recortada con "…"); el nombre completo va en el tooltip. */
function TickRecortado({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: unknown };
}) {
  const t = String(payload?.value ?? "");
  const corto = t.length > 22 ? `${t.slice(0, 21).trimEnd()}…` : t;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--foreground)" fontSize={11}>
      <title>{t}</title>
      {corto}
    </text>
  );
}

export function Grafico({ g, alto = 260 }: { g: GraficoReporte; alto?: number }) {
  if (g.datos.length === 0) {
    return (
      <p
        className="text-muted flex items-center justify-center text-sm"
        style={{ height: alto / 2 }}
      >
        Sin datos para el período.
      </p>
    );
  }
  const eje = (v: number) => formatearCompacto(v, g.formato === "moneda");
  const tooltip = (
    <Tooltip
      content={<Tip formato={g.formato} />}
      cursor={{ fill: "var(--surface-2)", stroke: "var(--input)" }}
    />
  );
  // El texto de la leyenda va en tinta neutra: el color lo lleva el cuadradito.
  const leyenda = g.series.length > 1 && (
    <Legend
      verticalAlign="top"
      align="right"
      height={28}
      iconType="square"
      iconSize={10}
      wrapperStyle={{ fontSize: 12 }}
      formatter={(v: string) => <span style={{ color: "var(--muted)" }}>{v}</span>}
    />
  );

  if (g.tipo === "donut") {
    const total = g.datos.reduce((a, d) => a + Number(d[g.series[0]!.clave] ?? 0), 0);
    return (
      <div className="@container">
        <div className="grid items-center gap-4 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div style={{ height: alto }} className="min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {tooltip}
                <Pie
                  data={g.datos}
                  dataKey={g.series[0]!.clave}
                  nameKey={g.x}
                  innerRadius="58%"
                  outerRadius="88%"
                  paddingAngle={1}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {g.datos.map((_, i) => (
                    <Cell key={i} fill={SERIES[i % SERIES.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Leyenda con valores: la identidad nunca queda solo en el color. */}
          <ul className="flex flex-col gap-1.5 text-sm">
            {g.datos.map((d, i) => {
              const v = Number(d[g.series[0]!.clave] ?? 0);
              return (
                <li key={String(d[g.x])} className="flex items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-sm"
                    style={{ background: SERIES[i % SERIES.length] }}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate">{String(d[g.x])}</span>
                  <span className="ml-auto shrink-0 font-medium whitespace-nowrap tabular-nums">
                    {valor(v, g.formato)}
                  </span>
                  <span className="text-muted w-11 shrink-0 text-right text-xs whitespace-nowrap tabular-nums">
                    {total ? `${Math.round((v / total) * 100)} %` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  if (g.tipo === "barrasH") {
    const s = g.series[0]!;
    return (
      <div style={{ height: Math.max(alto, g.datos.length * 30 + 20) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={g.datos}
            layout="vertical"
            margin={{ left: 0, right: 12, top: 4, bottom: 4 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--grilla)" />
            <XAxis
              type="number"
              tickFormatter={eje}
              tick={TICK}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey={g.x}
              width={150}
              tick={<TickRecortado />}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            {tooltip}
            <Bar
              dataKey={s.clave}
              name={s.nombre}
              fill={SERIES[0]}
              radius={[0, 4, 4, 0]}
              barSize={16}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (g.tipo === "barras") {
    return (
      <div style={{ height: alto }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={g.datos} margin={{ left: 0, right: 4, top: 4, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--grilla)" />
            <XAxis dataKey={g.x} tick={TICK} axisLine={false} tickLine={false} minTickGap={8} />
            <YAxis tickFormatter={eje} tick={TICK} axisLine={false} tickLine={false} width={56} />
            {tooltip}
            {leyenda}
            {g.series.map((s, i) => (
              <Bar
                key={s.clave}
                dataKey={s.clave}
                name={s.nombre}
                fill={SERIES[i]}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Área: ventas (y ganancia superpuesta, misma escala en $).
  return (
    <div style={{ height: alto }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={g.datos} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
          <defs>
            {g.series.map((s, i) => (
              <linearGradient
                key={s.clave}
                id={`grad-${g.id}-${s.clave}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={SERIES[i]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={SERIES[i]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grilla)" />
          <XAxis dataKey={g.x} tick={TICK} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tickFormatter={eje} tick={TICK} axisLine={false} tickLine={false} width={56} />
          <Tooltip
            content={<Tip formato={g.formato} />}
            cursor={{ stroke: "var(--input)", strokeWidth: 1 }}
          />
          {leyenda}
          {g.series.map((s, i) => (
            <Area
              key={s.clave}
              type="monotone"
              dataKey={s.clave}
              name={s.nombre}
              stroke={SERIES[i]}
              strokeWidth={2}
              fill={`url(#grad-${g.id}-${s.clave})`}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
