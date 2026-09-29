import "server-only";

import { rgb } from "pdf-lib";

import { formatearCompacto, formatearDelta, formatearNumero, formatearPesos } from "@/lib/format";
import type { CtxPanel } from "@/server/auth/permissions";
import {
  cerrarLienzo,
  GRIS,
  NEGRO,
  nuevoLienzo,
  type CabeceraPanel,
} from "@/server/reportes/exportar";
import { diasDelMes, nombreMes } from "@/server/reportes/filtros";
import {
  comprasDelPeriodo,
  fechaDeDia,
  kpis,
  rendimientoVendedores,
  serieComparativa,
  topProductos,
  type Comparado,
  type Periodo,
} from "@/server/services/analitica.service";

/**
 * Resumen mensual (SOLO dueños): UNA página A4 con KPIs contra el mes
 * anterior, facturación por día (barras), top 5 productos, compras vs.
 * ventas y el rendimiento del equipo.
 */

export function periodoDelMes(mes: string): Periodo {
  const { desde, hasta } = diasDelMes(mes);
  return { modo: "MENSUAL", desde: fechaDeDia(desde), hasta: fechaDeDia(hasta) };
}

export async function datosResumenMensual(ctx: CtxPanel, mes: string) {
  const p = periodoDelMes(mes);
  const [k, serie, top, compras, equipo] = await Promise.all([
    kpis(ctx, p),
    serieComparativa(ctx, p),
    topProductos(ctx, p, 5),
    comprasDelPeriodo(ctx, p),
    rendimientoVendedores(ctx, p),
  ]);
  return { mes, titulo: `Resumen de ${nombreMes(mes)}`, kpis: k, serie, top, compras, equipo };
}

export type DatosResumenMensual = Awaited<ReturnType<typeof datosResumenMensual>>;

const VERDE = rgb(0.09, 0.6, 0.35);
const ROJO = rgb(0.8, 0.2, 0.2);
const BORDE = rgb(0.86, 0.86, 0.88);
const BARRA = rgb(0.2, 0.36, 0.85);
const BARRA_ANT = rgb(0.8, 0.82, 0.86);

export async function pdfResumenMensual(
  cab: CabeceraPanel,
  d: DatosResumenMensual,
): Promise<Uint8Array> {
  const l = await nuevoLienzo(cab, d.titulo, ["Comparado con el mes anterior completo."]);
  const { page, margen: M, ancho } = l;
  const util = ancho - 2 * M;

  // --- KPIs (3 × 2) ---------------------------------------------------------
  const k = d.kpis;
  const tarjetas: {
    label: string;
    valor: string;
    c: Comparado<string> | Comparado<number> | null;
    extra?: string;
  }[] = [
    { label: "Facturado", valor: formatearPesos(k.facturado.actual), c: k.facturado },
    {
      label: "Ganancia bruta",
      valor: k.ganancia ? formatearPesos(k.ganancia.actual) : "—",
      c: k.ganancia,
      extra: k.margenPct !== null ? `margen ${k.margenPct.toLocaleString("es-AR")} %` : undefined,
    },
    { label: "Ventas", valor: formatearNumero(k.cantidadVentas.actual), c: k.cantidadVentas },
    {
      label: "Unidades vendidas",
      valor: formatearNumero(k.unidadesVendidas.actual),
      c: k.unidadesVendidas,
    },
    {
      label: "Ticket promedio",
      valor: formatearPesos(k.ticketPromedio.actual),
      c: k.ticketPromedio,
    },
    {
      label: "Clientes nuevos",
      valor: formatearNumero(k.clientesNuevos.actual),
      c: k.clientesNuevos,
    },
  ];
  const gap = 8;
  const w = (util - 2 * gap) / 3;
  const h = 50;
  tarjetas.forEach((t, i) => {
    const x = M + (i % 3) * (w + gap);
    const y = l.y - Math.floor(i / 3) * (h + gap) - h;
    page.drawRectangle({ x, y, width: w, height: h, borderColor: BORDE, borderWidth: 0.8 });
    l.texto(t.label, x + 8, y + h - 13, { size: 8, color: GRIS });
    l.texto(t.valor, x + 8, y + h - 30, { size: 14, font: l.negrita });
    const pct = t.c?.deltaPct ?? null;
    const texto = `${pct === null ? "sin datos del mes anterior" : `${formatearDelta(pct)} vs. mes anterior`}${t.extra ? ` · ${t.extra}` : ""}`;
    l.texto(texto, x + 8, y + 7, {
      size: 7.5,
      color: pct === null ? GRIS : pct >= 0 ? VERDE : ROJO,
      max: w - 12,
    });
  });
  l.y -= 2 * h + gap + 22;

  // --- Gráfico: facturación por día ------------------------------------------
  l.texto("Facturación por día", M, l.y, { size: 10.5, font: l.negrita });
  page.drawRectangle({ x: ancho - M - 150, y: l.y, width: 7, height: 7, color: BARRA });
  l.texto("este mes", ancho - M - 140, l.y, { size: 7.5, color: GRIS });
  page.drawRectangle({ x: ancho - M - 80, y: l.y, width: 7, height: 7, color: BARRA_ANT });
  l.texto("mes anterior", ancho - M - 70, l.y, { size: 7.5, color: GRIS });
  l.y -= 12;
  const altoG = 120;
  const base = l.y - altoG;
  const ejeX = M + 42;
  const anchoG = ancho - M - ejeX;
  const puntos = d.serie;
  const max = Math.max(1, ...puntos.flatMap((p) => [p.actual ?? 0, p.anterior ?? 0]));
  for (const frac of [0, 0.5, 1]) {
    const y = base + altoG * frac;
    page.drawLine({
      start: { x: ejeX, y },
      end: { x: ancho - M, y },
      thickness: 0.3,
      color: BORDE,
    });
    l.texto(formatearCompacto(max * frac, true), ejeX - 4, y - 3, {
      size: 6.5,
      color: GRIS,
      derecha: true,
    });
  }
  const paso = anchoG / Math.max(1, puntos.length);
  const barra = Math.max(1.5, paso * 0.36);
  puntos.forEach((p, i) => {
    const x = ejeX + i * paso + paso * 0.12;
    if (p.anterior) {
      page.drawRectangle({
        x,
        y: base,
        width: barra,
        height: (p.anterior / max) * altoG,
        color: BARRA_ANT,
      });
    }
    if (p.actual) {
      page.drawRectangle({
        x: x + barra,
        y: base,
        width: barra,
        height: (p.actual / max) * altoG,
        color: BARRA,
      });
    }
    if (i % Math.ceil(puntos.length / 10) === 0) {
      l.texto(p.etiqueta, x, base - 9, { size: 6.5, color: GRIS });
    }
  });
  l.y = base - 30;

  // --- Top 5 | Compras vs ventas ---------------------------------------------
  const col = (util - 16) / 2;
  const x2 = M + col + 16;
  const yTabla = l.y;
  l.texto("Top 5 productos", M, l.y, { size: 10.5, font: l.negrita });
  l.texto("Compras vs. ventas", x2, l.y, { size: 10.5, font: l.negrita });
  l.y -= 15;
  l.texto("Producto", M, l.y, { size: 7.5, color: GRIS });
  l.texto("Unid.", M + col - 70, l.y, { size: 7.5, color: GRIS, derecha: true });
  l.texto("Facturado", M + col, l.y, { size: 7.5, color: GRIS, derecha: true });
  let yTop = l.y - 13;
  if (d.top.length === 0) l.texto("Sin ventas en el mes.", M, yTop, { color: GRIS });
  d.top.forEach((t, i) => {
    l.texto(`${i + 1}. ${t.nombre}`, M, yTop, { max: col - 120 });
    l.texto(formatearNumero(t.unidades), M + col - 70, yTop, { derecha: true });
    l.texto(formatearPesos(t.facturado), M + col, yTop, { derecha: true });
    yTop -= 13;
  });
  const cv = d.compras;
  const filasCv: [string, string, string][] = [
    ["Ventas (facturado)", formatearPesos(cv.ventas.actual), formatearDelta(cv.ventas.deltaPct)],
    ["Compras recibidas", formatearPesos(cv.compras.actual), formatearDelta(cv.compras.deltaPct)],
    [
      "Costo de lo vendido",
      formatearPesos(cv.costoVendido.actual),
      formatearDelta(cv.costoVendido.deltaPct),
    ],
    [
      "Cantidad de compras",
      formatearNumero(cv.cantidadCompras.actual),
      formatearDelta(cv.cantidadCompras.deltaPct),
    ],
    [
      "Ventas - compras",
      formatearPesos((Number(cv.ventas.actual) - Number(cv.compras.actual)).toFixed(2)),
      "",
    ],
  ];
  l.texto("Concepto", x2, yTabla - 15, { size: 7.5, color: GRIS });
  l.texto("Mes", x2 + col - 60, yTabla - 15, { size: 7.5, color: GRIS, derecha: true });
  l.texto("vs. ant.", x2 + col, yTabla - 15, { size: 7.5, color: GRIS, derecha: true });
  let yCv = yTabla - 28;
  for (const [a, b, c] of filasCv) {
    l.texto(a, x2, yCv, { max: col - 150 });
    l.texto(b, x2 + col - 60, yCv, {
      derecha: true,
      font: a.startsWith("Ventas -") ? l.negrita : l.normal,
    });
    l.texto(c, x2 + col, yCv, { derecha: true, color: GRIS });
    yCv -= 13;
  }
  l.y = Math.min(yTop, yCv) - 16;

  // --- Rendimiento del equipo ------------------------------------------------
  l.texto("Rendimiento del equipo", M, l.y, { size: 10.5, font: l.negrita });
  l.y -= 15;
  const cols = [
    { t: "Vendedor", x: M, der: false },
    { t: "Ventas", x: M + util * 0.42, der: true },
    { t: "Unidades", x: M + util * 0.54, der: true },
    { t: "Facturado", x: M + util * 0.7, der: true },
    { t: "Ticket prom.", x: M + util * 0.85, der: true },
    { t: "Comisión est.", x: M + util, der: true },
  ];
  cols.forEach((c) => l.texto(c.t, c.x, l.y, { size: 7.5, color: GRIS, derecha: c.der }));
  l.y -= 13;
  const equipo = d.equipo
    .filter((v) => v.cantidadVentas > 0)
    .slice(0, Math.max(1, Math.floor((l.y - M - 20) / 13)));
  if (equipo.length === 0) l.texto("Nadie vendió en el mes.", M, l.y, { color: GRIS });
  for (const v of equipo) {
    const valores = [
      v.nombre,
      formatearNumero(v.cantidadVentas),
      formatearNumero(v.unidades),
      formatearPesos(v.facturado),
      formatearPesos(v.ticketPromedio),
      v.comision ? formatearPesos(v.comision.estimada) : "—",
    ];
    cols.forEach((c, i) =>
      l.texto(valores[i]!, c.x, l.y, {
        derecha: c.der,
        color: NEGRO,
        max: i === 0 ? util * 0.38 : undefined,
      }),
    );
    l.y -= 13;
  }
  return cerrarLienzo(l);
}
