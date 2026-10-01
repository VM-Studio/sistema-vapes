import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Tema central de los gráficos (recharts): acá se definen los colores con que
 * aparecen el azul, el naranja y el oliva del logo en los datos:
 * - serie "Actual" = azul, serie "Anterior" = naranja (punteada);
 * - escala categórica fija: azul → azul claro → naranja → naranja claro → oliva → gris;
 * - deltas: sube = azul, baja = naranja (con flecha/signo: no depende solo del color).
 * Grilla gris, ejes sin línea, tooltips con el estilo de tarjeta.
 */
export const COLORES_MARCA = {
  azul: "#004aac",
  azulClaro: "#7fa3d6",
  azulOscuro: "#003580",
  naranja: "#ff914d",
  naranjaClaro: "#ffc59f",
  naranjaOscuro: "#d9661f",
  oliva: "#aeb03f",
  marron: "#594a42",
} as const;

export const ChartTheme = {
  actual: COLORES_MARCA.azul,
  anterior: COLORES_MARCA.naranja,
  sube: COLORES_MARCA.azul,
  baja: COLORES_MARCA.naranjaOscuro,
  /** Orden fijo: el color sigue a la categoría, nunca se cicla por ranking. */
  escala: [
    COLORES_MARCA.azul,
    COLORES_MARCA.azulClaro,
    COLORES_MARCA.naranja,
    COLORES_MARCA.naranjaClaro,
    COLORES_MARCA.oliva,
    "#cfc7c1",
  ],
  grilla: "#e9eef5",
  eje: "#e3e9f1",
  texto: "#6e625b",
  textoFuerte: COLORES_MARCA.marron,
  cursor: "#cfd8e4",
  cursorArea: "rgba(0,74,172,0.05)",
  fuente: 12,
  /** Props listas para <CartesianGrid>. */
  grid: { stroke: "#e9eef5", vertical: false } as const,
  /** Props listas para <XAxis>/<YAxis>. */
  ejeX: {
    tickLine: false,
    axisLine: { stroke: "#e3e9f1" },
    tick: { fontSize: 12, fill: "#6e625b" },
  } as const,
  ejeY: { tickLine: false, axisLine: false, tick: { fontSize: 12, fill: "#6e625b" } } as const,
  /** contentStyle del <Tooltip> por defecto de recharts. */
  tooltip: {
    background: "#f2f6fb",
    border: "1px solid rgba(0,74,172,0.08)",
    borderRadius: 10,
    boxShadow: "0 8px 20px -6px rgb(16 36 72 / 0.1)",
    fontSize: 13,
    color: COLORES_MARCA.marron,
    padding: "8px 12px",
  } satisfies CSSProperties,
  leyenda: { fontSize: 12, color: "#6e625b" } satisfies CSSProperties,
} as const;

/** Color de la categoría i (escala fija, sin ciclar colores de marca). */
export function colorSerie(i: number): string {
  return ChartTheme.escala[Math.min(i, ChartTheme.escala.length - 1)]!;
}

/** Contenedor para tooltips personalizados (mismo estilo que las tarjetas). */
export function ChartTooltipCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card shadow-pop rounded-card border-marca-azul/[0.08] min-w-44 border p-3 text-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Lugar del gráfico cuando no hay datos: nunca un gráfico roto, un placeholder
 * con líneas de grilla y el mensaje centrado.
 */
export function ChartPlaceholder({
  mensaje = "Todavía no hay datos en este período",
  className,
}: {
  mensaje?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-control relative flex h-64 w-full items-center justify-center overflow-hidden md:h-80",
        className,
      )}
      role="img"
      aria-label={mensaje}
    >
      <div className="absolute inset-0 flex flex-col justify-between py-6" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="border-grilla border-t" />
        ))}
      </div>
      <p className="text-subtle relative px-3 text-sm">{mensaje}</p>
    </div>
  );
}
