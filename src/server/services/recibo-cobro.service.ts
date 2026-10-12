import "server-only";

import { PDFDocument, StandardFonts, type PDFFont, type PDFImage, type rgb } from "pdf-lib";

import { formatearPesos } from "@/lib/format";
import { logosCandidatos } from "@/lib/paneles";
import { formatearFechaHora } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { dbPara, type Ctx } from "@/server/db/panel-scoped";
import { NotFoundError } from "@/server/errors";
import { aWinAnsi, cargarLogoPdf, COLOR_PDF, recortar, rectRedondeado } from "@/server/pdf";
import { clavePdf, pdfCacheado } from "@/server/pdf-http";
import { nombreNegocio } from "@/server/services/identidad.service";

/** Un cobro de cuenta corriente (todos los PagoVenta con el mismo `cobroId`). */
export interface ReciboCobro {
  cobroId: string;
  fecha: Date;
  cliente: { nombre: string; telefono: string | null; saldoActual: string };
  medioPago: string;
  referencia: string | null;
  monto: string;
  usuario: string;
  imputaciones: { codigo: string; fecha: Date; total: string; monto: string; saldoHoy: string }[];
  anulado: boolean;
  motivoAnulacion: string | null;
}

export async function obtenerReciboCobro(ctx: Ctx, cobroId: string): Promise<ReciboCobro> {
  const pagos = await dbPara(ctx.panelId).pagoVenta.findMany({
    where: { cobroId, esCobroPosterior: true },
    orderBy: { createdAt: "asc" },
    include: {
      usuario: { select: { nombre: true } },
      venta: {
        select: {
          codigo: true,
          fecha: true,
          total: true,
          saldoPendiente: true,
          cliente: { select: { nombre: true, telefono: true, saldoDeudor: true } },
        },
      },
    },
  });
  const primero = pagos[0];
  if (!primero?.venta.cliente) throw new NotFoundError("El cobro no existe.");
  const cliente = primero.venta.cliente;
  return {
    cobroId,
    fecha: primero.fecha,
    cliente: {
      nombre: cliente.nombre,
      telefono: cliente.telefono,
      saldoActual: cliente.saldoDeudor.toFixed(2),
    },
    medioPago: ETIQUETA_MEDIO_PAGO[primero.medioPago],
    referencia: primero.referencia,
    monto: pagos.reduce((a, p) => a + Number(p.monto), 0).toFixed(2),
    usuario: primero.usuario.nombre,
    imputaciones: pagos.map((p) => ({
      codigo: p.venta.codigo,
      fecha: p.venta.fecha,
      total: p.venta.total.toFixed(2),
      monto: p.monto.toFixed(2),
      saldoHoy: p.venta.saldoPendiente.toFixed(2),
    })),
    anulado: pagos.every((p) => p.anulado),
    motivoAnulacion: primero.motivoAnulacion,
  };
}

/**
 * Recibo PDF de un cobro de fiado (A5 vertical): negocio y panel, número de
 * cobro, fecha, cliente, medio, monto, ventas a las que se imputó y saldo
 * actual del cliente. Si el cobro se anuló, lo dice en grande. Lo sirve
 * `GET /api/p/{slug}/fiados/cobros/{cobroId}/recibo`; cacheado en el storage
 * con una firma de lo que dibuja (si se anula o cambia el saldo, se regenera).
 */
export async function pdfReciboCobro(
  ctx: Ctx,
  cobroId: string,
): Promise<{ pdf: Uint8Array; archivo: string }> {
  const [r, panel, negocio] = await Promise.all([
    obtenerReciboCobro(ctx, cobroId),
    dbPara(ctx.panelId).panel.findUniqueOrThrow({
      where: { id: ctx.panelId },
      select: { nombre: true, slug: true, logoUrl: true },
    }),
    nombreNegocio(),
  ]);
  const numero = numeroRecibo(cobroId);
  const clave = clavePdf("recibo", ctx.panelId, cobroId, { v: 1, r, panel, negocio });
  const pdf = await pdfCacheado(clave, () => dibujarRecibo(r, numero, panel, negocio));
  return { pdf, archivo: `recibo-${numero}.pdf` };
}

/** Número corto y estable para mostrar: los primeros 8 caracteres del cobro. */
export function numeroRecibo(cobroId: string): string {
  return cobroId.replace(/^cob_/, "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

async function dibujarRecibo(
  r: ReciboCobro,
  numero: string,
  panel: { nombre: string; slug: string; logoUrl: string | null },
  negocio: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${numero}`);
  doc.setCreator(negocio);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  let logo: PDFImage | null = null;
  for (const url of logosCandidatos(panel.slug, panel.logoUrl)) {
    logo = await cargarLogoPdf(doc, url);
    if (logo) break;
  }

  // A5 vertical.
  const ANCHO = 419.53;
  const ALTO = 595.28;
  const M = 32;
  const util = ANCHO - 2 * M;
  const negro = COLOR_PDF.texto;
  const gris = COLOR_PDF.muted;
  const fondo = COLOR_PDF.card;
  const linea = COLOR_PDF.borde;
  let page = doc.addPage([ANCHO, ALTO]);
  let y = ALTO - M;

  const texto = (
    s: string,
    x: number,
    yy: number,
    opts: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      derecha?: boolean;
      max?: number;
    } = {},
  ) => {
    const font = opts.font ?? normal;
    const size = opts.size ?? 9;
    let w = aWinAnsi(s, font);
    if (opts.max) w = recortar(w, font, size, opts.max);
    const dx = opts.derecha ? font.widthOfTextAtSize(w, size) : 0;
    page.drawText(w, { x: x - dx, y: yy, size, font, color: opts.color ?? negro });
  };
  const raya = (yy: number, grosor = 0.4) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: ANCHO - M, y: yy },
      thickness: grosor,
      color: linea,
    });

  // Cabecera.
  const ALTO_CAB = 40;
  if (logo) {
    const escala = Math.min(130 / logo.width, ALTO_CAB / logo.height);
    page.drawImage(logo, {
      x: M,
      y: y - ALTO_CAB + (ALTO_CAB - logo.height * escala) / 2,
      width: logo.width * escala,
      height: logo.height * escala,
    });
  } else {
    texto(panel.nombre, M, y - 26, { size: 16, font: negrita });
  }
  texto(negocio, ANCHO - M, y - 12, { size: 10, font: negrita, derecha: true });
  texto(panel.nombre, ANCHO - M, y - 25, { size: 8.5, color: gris, derecha: true });
  y -= ALTO_CAB + 14;
  raya(y, 0.6);
  y -= 30;

  texto("Recibo de cobro", M, y, { size: 17, font: negrita });
  texto(`N° ${numero}`, ANCHO - M, y, { size: 12, font: mono, derecha: true });
  y -= 20;

  if (r.anulado) {
    rectRedondeado(page, M, y - 34, util, 34, 6, fondo);
    texto("COBRO ANULADO", M + 12, y - 15, { size: 11, font: negrita, color: COLOR_PDF.baja });
    texto(r.motivoAnulacion ?? "Sin motivo", M + 12, y - 27, {
      size: 8,
      color: gris,
      max: util - 24,
    });
    y -= 46;
  }

  // Datos del cobro.
  const filas: [string, string][] = [
    ["Fecha", formatearFechaHora(r.fecha)],
    ["Cliente", r.cliente.nombre],
    ...(r.cliente.telefono ? ([["Teléfono", r.cliente.telefono]] as [string, string][]) : []),
    ["Medio de pago", r.medioPago],
    ...(r.referencia ? ([["Referencia", r.referencia]] as [string, string][]) : []),
    ["Registró", r.usuario],
  ];
  const altoDatos = filas.length * 15 + 14;
  rectRedondeado(page, M, y - altoDatos, util, altoDatos, 6, fondo);
  let yy = y - 18;
  for (const [etiqueta, valor] of filas) {
    texto(etiqueta, M + 12, yy, { size: 8, color: gris });
    texto(valor, M + 110, yy, { size: 9.5, max: util - 122 });
    yy -= 15;
  }
  y -= altoDatos + 24;

  // Monto recibido.
  texto("Recibimos", M, y, { size: 10, color: gris });
  texto(formatearPesos(r.monto), ANCHO - M, y - 4, { size: 20, font: negrita, derecha: true });
  y -= 30;
  raya(y, 0.6);
  y -= 22;

  // Imputación a las ventas.
  texto("Aplicado a", M, y, { font: negrita, size: 10 });
  y -= 18;
  const xVenta = M;
  const xMonto = ANCHO - M - 90;
  const xSaldo = ANCHO - M;
  const o = { font: negrita, size: 7.5, color: gris };
  texto("Venta", xVenta, y, o);
  texto("Cobrado", xMonto, y, { ...o, derecha: true });
  texto("Saldo hoy", xSaldo, y, { ...o, derecha: true });
  y -= 8;
  raya(y);
  y -= 14;
  for (const i of r.imputaciones) {
    if (y < M + 70) {
      page = doc.addPage([ANCHO, ALTO]);
      y = ALTO - M;
    }
    texto(`${i.codigo} · ${formatearFechaHora(i.fecha).slice(0, 8)}`, xVenta, y, { size: 9 });
    texto(formatearPesos(i.monto), xMonto, y, { size: 9, derecha: true });
    texto(formatearPesos(i.saldoHoy), xSaldo, y, { size: 9, derecha: true });
    y -= 8;
    raya(y);
    y -= 14;
  }

  y -= 8;
  texto("Saldo actual de la cuenta", M, y, { font: negrita, size: 10 });
  texto(formatearPesos(r.cliente.saldoActual), ANCHO - M, y, {
    font: negrita,
    size: 12,
    derecha: true,
  });

  // Pie.
  for (const p of doc.getPages()) {
    p.drawLine({
      start: { x: M, y: M + 4 },
      end: { x: ANCHO - M, y: M + 4 },
      thickness: 0.4,
      color: linea,
    });
    const s = aWinAnsi(`Recibo ${numero} · ${negocio}`, normal);
    p.drawText(s, {
      x: ANCHO - M - normal.widthOfTextAtSize(s, 7),
      y: M - 8,
      size: 7,
      font: normal,
      color: COLOR_PDF.subtle,
    });
  }
  return doc.save();
}
