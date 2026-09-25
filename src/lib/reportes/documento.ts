import { formatearNumero, formatearPesos } from "@/lib/format";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";

/**
 * Un reporte, independiente de cómo se muestra: la misma estructura se
 * dibuja en pantalla (tablas + gráficos), en PDF (pdf-lib) y en Excel
 * (exceljs). Así lo que se ve es exactamente lo que se exporta.
 */

export type TipoCelda =
  "texto" | "entero" | "decimal" | "moneda" | "porcentaje" | "fecha" | "fechaHora";

export interface ColumnaReporte {
  clave: string;
  titulo: string;
  tipo: TipoCelda;
  /** Ancho relativo en PDF / caracteres en Excel (default según tipo). */
  ancho?: number;
  /** Clave de la fila con un href (solo pantalla). */
  enlace?: string;
}

/** Valores ya calculados. Montos como string "1234.50", fechas como ISO. */
export type Celda = string | number | null;

export interface FilaReporte {
  [clave: string]: Celda | undefined;
  /** "grupo": encabezado de grupo; "subtotal": en negrita. */
  _estilo?: "grupo" | "subtotal";
  /** Resalta la fila (ej. caja con diferencia). */
  _alerta?: "danger" | "warning";
}

export interface SeccionReporte {
  id: string;
  titulo: string;
  descripcion?: string;
  columnas: ColumnaReporte[];
  filas: FilaReporte[];
  totales?: FilaReporte;
  /** Texto si no hay filas. */
  vacio?: string;
}

export interface SerieGrafico {
  clave: string;
  nombre: string;
}

export interface GraficoReporte {
  id: string;
  tipo: "area" | "barras" | "barrasH" | "donut";
  titulo: string;
  /** Eje x (o etiqueta de categoría). */
  x: string;
  /** Formato de los valores. */
  formato: "moneda" | "entero";
  series: SerieGrafico[];
  datos: Record<string, string | number>[];
  /** También se dibuja en el PDF (solo barras / área simples). */
  enPdf?: boolean;
}

export interface KpiReporte {
  etiqueta: string;
  valor: Celda;
  tipo: TipoCelda;
  /** Variación % contra el período anterior. */
  delta?: number | null;
  /** Para costos: una suba es mala. */
  deltaInvertido?: boolean;
}

export interface DocumentoReporte {
  titulo: string;
  subtitulo?: string;
  /** Período y filtros aplicados, para la cabecera. */
  filtros: { etiqueta: string; valor: string }[];
  kpis?: KpiReporte[];
  graficos?: GraficoReporte[];
  secciones: SeccionReporte[];
  orientacion: "vertical" | "apaisado";
  nota?: string;
}

/** Texto de una celda para pantalla y PDF. */
export function formatearCelda(valor: Celda | undefined, tipo: TipoCelda): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  switch (tipo) {
    case "moneda":
      return formatearPesos(valor);
    case "entero":
      return formatearNumero(Number(valor));
    case "decimal":
      return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Number(valor));
    case "porcentaje":
      return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(Number(valor))} %`;
    case "fecha":
      if (Number.isNaN(new Date(String(valor)).getTime())) return String(valor); // "Total"
      return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)
        ? `${valor.slice(8, 10)}/${valor.slice(5, 7)}/${valor.slice(2, 4)}`
        : formatearFecha(String(valor));
    case "fechaHora":
      if (Number.isNaN(new Date(String(valor)).getTime())) return String(valor);
      return formatearFechaHora(String(valor));
    default:
      return String(valor);
  }
}

export const esNumerica = (tipo: TipoCelda) =>
  tipo === "entero" || tipo === "decimal" || tipo === "moneda" || tipo === "porcentaje";
