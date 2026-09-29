import "server-only";

import { formatearCompacto, formatearDelta, formatearNumero, formatearPesos } from "@/lib/format";
import type { CtxPanel } from "@/server/auth/permissions";
import { COLOR_PDF, rectRedondeado } from "@/server/pdf";
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

// Deltas: azul sube / naranja baja; barras: Actual azul, Anterior naranja (como en la app).
const SUBE = COLOR_PDF.sube;
const BAJA = COLOR_PDF.baja;
const BORDE = COLOR_PDF.borde;
const FONDO = COLOR_PDF.card;
const BARRA = COLOR_PDF.actual;
const BARRA_ANT = COLOR_PDF.anterior;

/** Banda gris clarito de encabezado de tabla. */
function bandaEncabezado(
  page: Parameters<typeof rectRedondeado>[0],
  x: number,
  y: number,
  ancho: number,
) {
  rectRedondeado(page, x, y - 6, ancho, 18, 3, FONDO);
}

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
  const h = 58;
  tarjetas.forEach((t, i) => {
    const x = M + (i % 3) * (w + gap);
    const y = l.y - Math.floor(i / 3) * (h + gap) - h;
    rectRedondeado(page, x, y, w, h, 6, FONDO);
    l.texto(t.label, x + 10, y + h - 15, { size: 8, color: GRIS });
    l.texto(t.valor, x + 10, y + h - 34, { size: 15, font: l.negrita, max: w - 20 });
    const pct = t.c?.deltaPct ?? null;
    const delta =
      pct === null ? "sin datos del mes anterior" : formatearDelta(pct).replace(/−/g, "-");
    l.texto(delta, x + 10, y + 9, {
      size: 7.5,
      font: pct === null ? l.normal : l.negrita,
      color: pct === null ? GRIS : pct >= 0 ? SUBE : BAJA,
      max: w - 20,
    });
    if (pct !== null) {
      const dx = l.negrita.widthOfTextAtSize(delta, 7.5) + 4;
      l.texto(`vs. mes anterior${t.extra ? ` · ${t.extra}` : ""}`, x + 10 + dx, y + 9, {
        size: 7.5,
        color: GRIS,
        max: w - 20 - dx,
      });
    }
  });
  l.y -= 2 * h + gap + 26;

  // --- Gráfico: facturación por día ------------------------------------------
  l.texto("Facturación por día", M, l.y, { size: 11, font: l.negrita });
  // Leyenda a la derecha: cuadrado de color pegado a su etiqueta.
  const anchoAnt = l.normal.widthOfTextAtSize("Mes anterior", 7.5);
  const anchoAct = l.normal.widthOfTextAtSize("Este mes", 7.5);
  const xAnt = ancho - M - anchoAnt - 11;
  const xAct = xAnt - 16 - anchoAct - 11;
  rectRedondeado(page, xAct, l.y, 7, 7, 1.5, BARRA);
  l.texto("Este mes", xAct + 11, l.y, { size: 7.5, color: GRIS });
  rectRedondeado(page, xAnt, l.y, 7, 7, 1.5, BARRA_ANT);
  l.texto("Mes anterior", xAnt + 11, l.y, { size: 7.5, color: GRIS });
  l.y -= 16;
  const altoG = 116;
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
  l.texto("Top 5 productos", M, l.y, { size: 11, font: l.negrita });
  l.texto("Compras vs. ventas", x2, l.y, { size: 11, font: l.negrita });
  l.y -= 18;
  bandaEncabezado(page, M, l.y, col);
  bandaEncabezado(page, x2, l.y, col);
  l.texto("Producto", M + 5, l.y, { size: 7.5, color: GRIS, font: l.negrita });
  l.texto("Unid.", M + col - 70, l.y, { size: 7.5, color: GRIS, derecha: true, font: l.negrita });
  l.texto("Facturado", M + col - 5, l.y, {
    size: 7.5,
    color: GRIS,
    derecha: true,
    font: l.negrita,
  });
  let yTop = l.y - 18;
  if (d.top.length === 0) l.texto("Sin ventas en el mes.", M + 5, yTop, { color: GRIS });
  d.top.forEach((t, i) => {
    l.texto(`${i + 1}. ${t.nombre}`, M + 5, yTop, { max: col - 125 });
    l.texto(formatearNumero(t.unidades), M + col - 70, yTop, { derecha: true });
    l.texto(formatearPesos(t.facturado), M + col - 5, yTop, { derecha: true });
    page.drawLine({
      start: { x: M, y: yTop - 5 },
      end: { x: M + col, y: yTop - 5 },
      thickness: 0.3,
      color: BORDE,
    });
    yTop -= 15;
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
  l.texto("Concepto", x2 + 5, yTabla - 18, { size: 7.5, color: GRIS, font: l.negrita });
  l.texto("Mes", x2 + col - 60, yTabla - 18, {
    size: 7.5,
    color: GRIS,
    derecha: true,
    font: l.negrita,
  });
  l.texto("vs. ant.", x2 + col - 5, yTabla - 18, {
    size: 7.5,
    color: GRIS,
    derecha: true,
    font: l.negrita,
  });
  let yCv = yTabla - 36;
  for (const [a, b, c] of filasCv) {
    const total = a.startsWith("Ventas -");
    if (total) {
      page.drawLine({
        start: { x: x2, y: yCv + 10 },
        end: { x: x2 + col, y: yCv + 10 },
        thickness: 0.8,
        color: NEGRO,
      });
    }
    l.texto(a, x2 + 5, yCv, { max: col - 150, font: total ? l.negrita : l.normal });
    l.texto(b, x2 + col - 60, yCv, { derecha: true, font: total ? l.negrita : l.normal });
    l.texto(c, x2 + col - 5, yCv, { derecha: true, color: GRIS });
    if (!total) {
      page.drawLine({
        start: { x: x2, y: yCv - 5 },
        end: { x: x2 + col, y: yCv - 5 },
        thickness: 0.3,
        color: BORDE,
      });
    }
    yCv -= 15;
  }
  l.y = Math.min(yTop, yCv) - 18;

  // --- Rendimiento del equipo ------------------------------------------------
  l.texto("Rendimiento del equipo", M, l.y, { size: 11, font: l.negrita });
  l.y -= 18;
  const cols = [
    { t: "Vendedor", x: M + 5, der: false },
    { t: "Ventas", x: M + util * 0.42, der: true },
    { t: "Unidades", x: M + util * 0.54, der: true },
    { t: "Facturado", x: M + util * 0.7, der: true },
    { t: "Ticket prom.", x: M + util * 0.85, der: true },
    { t: "Comisión est.", x: M + util - 5, der: true },
  ];
  bandaEncabezado(page, M, l.y, util);
  cols.forEach((c) =>
    l.texto(c.t, c.x, l.y, { size: 7.5, color: GRIS, derecha: c.der, font: l.negrita }),
  );
  l.y -= 18;
  const equipo = d.equipo
    .filter((v) => v.cantidadVentas > 0)
    .slice(0, Math.max(1, Math.floor((l.y - M - 20) / 15)));
  if (equipo.length === 0) l.texto("Nadie vendió en el mes.", M + 5, l.y, { color: GRIS });
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
    page.drawLine({
      start: { x: M, y: l.y - 5 },
      end: { x: M + util, y: l.y - 5 },
      thickness: 0.3,
      color: BORDE,
    });
    l.y -= 15;
  }
  return cerrarLienzo(l);
}
