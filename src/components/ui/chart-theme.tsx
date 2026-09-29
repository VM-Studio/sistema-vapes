import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Tema central de los gráficos (recharts). Es el ÚNICO lugar del sistema donde
 * aparecen el azul y el naranja del logo:
 * - serie "Actual" = azul, serie "Anterior" = naranja (punteada);
 * - escala categórica fija: azul → azul claro → naranja → naranja claro → grises;
 * - deltas: sube = azul, baja = naranja (con flecha/signo: no depende solo del color).
 * Grilla gris, ejes sin línea, tooltips con el estilo de tarjeta.
 */
export const COLORES_MARCA = {
  azul: "#0047b0",
  azulClaro: "#7fa6e0",
  azulOscuro: "#00337f",
  naranja: "#fe7b38",
  naranjaClaro: "#ffb892",
  naranjaOscuro: "#d95e1e",
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
    "#a3a3a3",
    "#d4d4d4",
  ],
  grilla: "#eceef1",
  eje: "#e6e8eb",
  texto: "#525252",
  textoFuerte: "#0a0a0a",
  cursor: "#d4d7dc",
  cursorArea: "rgba(10,10,10,0.04)",
  fuente: 12,
  /** Props listas para <CartesianGrid>. */
  grid: { stroke: "#eceef1", vertical: false } as const,
  /** Props listas para <XAxis>/<YAxis>. */
  ejeX: {
    tickLine: false,
    axisLine: { stroke: "#e6e8eb" },
    tick: { fontSize: 12, fill: "#525252" },
  } as const,
  ejeY: { tickLine: false, axisLine: false, tick: { fontSize: 12, fill: "#525252" } } as const,
  /** contentStyle del <Tooltip> por defecto de recharts. */
  tooltip: {
    background: "#f4f5f7",
    border: "1px solid rgba(10,10,10,0.06)",
    borderRadius: 10,
    boxShadow: "0 8px 20px -6px rgb(10 10 10 / 0.1)",
    fontSize: 13,
    color: "#0a0a0a",
    padding: "8px 12px",
  } satisfies CSSProperties,
  leyenda: { fontSize: 12, color: "#525252" } satisfies CSSProperties,
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
        "bg-card shadow-pop min-w-44 rounded-card border border-black/[0.06] p-3 text-sm",
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
        "relative flex h-64 w-full items-center justify-center overflow-hidden rounded-control md:h-80",
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
