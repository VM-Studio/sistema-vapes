import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  AccionAuditoria,
  EstadoLiquidacion,
  Prisma,
  ResultadoEnvioMail,
  RolFirmaRemito,
  RolUsuario,
  TipoEnvioRemito,
  type MedioPago,
} from "@prisma/client";
import { PDFDocument, StandardFonts, type PDFFont, type PDFImage, type rgb } from "pdf-lib";
import { z } from "zod";

import { obtenerEnv } from "@/env";
import { formatearPesos } from "@/lib/format";
import {
  CATEGORIAS_GANANCIA,
  ETIQUETA_CATEGORIA,
  mesDeFecha,
  nombreMes,
  type ResumenCategoria,
} from "@/lib/ganancia-vendedor";
import { prefijoPanel, rutaPanel } from "@/lib/paneles";
import { esOwner, type SujetoPermisos } from "@/lib/permisos";
import { ahora } from "@/lib/reloj";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import type { RequestMeta } from "@/server/auth/request-meta";
import { liquidacionPorTokenHash } from "@/server/db/firma-token";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { enviarMail, mailConfigurado, mailsDuenos, type ResultadoMail } from "@/server/mail";
import { aWinAnsi, cargarLogoPanelPdf, COLOR_PDF, recortar, rectRedondeado } from "@/server/pdf";
import { clavePdf, pdfCacheado } from "@/server/pdf-http";
import { registrarAuditoria } from "@/server/services/audit.service";
import {
  registrarPagoEnTx,
  type DatosPagoLiquidacion,
} from "@/server/services/ganancia-vendedor.service";
import { nombreNegocio } from "@/server/services/identidad.service";

/**
 * REMITO DE PAGO de una liquidación de vendedor, con las dos firmas.
 *
 * 1. Un dueño registra el pago y FIRMA (canvas): PENDIENTE → PAGADA, queda
 *    su firma (FirmaRemito DUENO) y un link de firma para el vendedor
 *    (/firma/{token}: 32 bytes aleatorios; en la DB solo el SHA-256; un solo
 *    uso; vence a los 14 días). Se le manda al vendedor (email de su usuario)
 *    el remito PDF firmado por el dueño, diciendo QUÉ DUEÑO lo firmó y mandó,
 *    con el link. Sin mail configurado queda registrado "sin configurar" y la
 *    pantalla ofrece copiar el link o mandarlo por WhatsApp.
 * 2. El vendedor abre el link (o entra con su usuario), ve el remito, firma y
 *    toca "Firmado": PAGADA → FIRMADA con su firma (fecha, IP, user agent);
 *    el PDF se regenera con las dos firmas y se manda a los dueños
 *    (MAIL_DUENOS o, si falta, GMAIL_USER).
 * Cada envío queda en EnvioRemito (a quién, cuándo, resultado). Firmas y
 * envíos son inmutables (trigger). Las firmas se guardan en la DB (PNG
 * re-codificado, < 200 KB): entran en los backups sin depender del storage.
 */

export const DIAS_VIGENCIA_LINK = 14;
const MAX_FIRMA_BYTES = 200_000;

type CtxConUsuario = Ctx & { usuario?: Pick<SujetoPermisos, "rol"> };

async function exigirOwner(ctx: CtxConUsuario, que: string): Promise<void> {
  const owner = ctx.usuario
    ? esOwner(ctx.usuario)
    : (
        await dbPara(ctx.panelId).usuario.findUnique({
          where: { id: ctx.usuarioId },
          select: { rol: true },
        })
      )?.rol === RolUsuario.OWNER;
  if (!owner) throw new ForbiddenError(`${que}: solo los dueños.`);
}

// =============================================================================
// Token y firma (puro)
// =============================================================================

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function nuevoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const TOKEN_VALIDO = /^[A-Za-z0-9_-]{43}$/;

/** URL pública del link de firma (NEXT_PUBLIC_APP_URL). */
export function urlFirma(token: string): string {
  const base = obtenerEnv().NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return new URL(`/firma/${token}`, base).toString();
}

/**
 * "data:image/png;base64,…" del canvas → PNG limpio (sharp: re-codificado,
 * sin metadatos, máx. 1200 px). Rechaza lo que no es PNG y la firma vacía.
 */
export async function procesarFirma(dataUrl: string): Promise<Uint8Array> {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new ValidationError("Firmá en el recuadro", { firma: ["Firma inválida"] });
  const bytes = new Uint8Array(Buffer.from(m[1]!, "base64"));
  if (bytes.byteLength > 2 * MAX_FIRMA_BYTES * 4)
    throw new ValidationError("La firma es demasiado grande", { firma: ["Demasiado grande"] });
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47))
    throw new ValidationError("Firmá en el recuadro", { firma: ["No es una imagen PNG"] });
  const { default: sharp } = await import("sharp");
  let img;
  try {
    img = sharp(bytes, { limitInputPixels: 10_000_000, failOn: "error" }).ensureAlpha();
    const stats = await img.stats();
    const alfa = stats.channels[3];
    // Sin trazos: todo transparente.
    if (!alfa || alfa.max === 0)
      throw new ValidationError("Firmá en el recuadro", { firma: ["La firma está vacía"] });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Firmá en el recuadro", { firma: ["Imagen inválida"] });
  }
  const salida = await img
    .resize({ width: 1200, height: 600, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  if (salida.byteLength > MAX_FIRMA_BYTES)
    throw new ValidationError("La firma es demasiado grande", { firma: ["Demasiado grande"] });
  return new Uint8Array(salida);
}

const dataUrlPng = (b: Uint8Array) => `data:image/png;base64,${Buffer.from(b).toString("base64")}`;

// =============================================================================
// Datos del remito
// =============================================================================

export interface FirmaVista {
  rol: RolFirmaRemito;
  nombre: string;
  usuarioId: string;
  firmadaAt: Date;
  ip: string | null;
  medio: string | null;
  /** data:image/png;base64,… */
  imagen: string;
}

export interface EnvioVista {
  id: string;
  tipo: TipoEnvioRemito;
  destinatarios: string[];
  enviadoPor: string | null;
  resultado: ResultadoEnvioMail;
  detalle: string | null;
  createdAt: Date;
}

export interface Remito {
  id: string;
  numero: string;
  estado: EstadoLiquidacion;
  mes: string;
  panel: { id: string; nombre: string; slug: string; logoUrl: string | null };
  negocio: string;
  vendedor: { id: string; nombre: string; email: string };
  categorias: ResumenCategoria[];
  total: string;
  cantidadVentas: number;
  unidades: number;
  pago: {
    monto: string;
    medioPago: MedioPago;
    referencia: string | null;
    fecha: Date;
    registradoPor: string;
  } | null;
  firmaDueno: FirmaVista | null;
  firmaVendedor: FirmaVista | null;
  firmadaAt: Date | null;
  link: { venceAt: Date | null; usadoAt: Date | null; vencido: boolean } | null;
  envios: EnvioVista[];
}

const resumenSchema = z.object({
  categoria: z.enum(CATEGORIAS_GANANCIA),
  ventas: z.number().int(),
  unidades: z.number().int(),
  unidadesDevueltas: z.number().int(),
  tarifa: z.string(),
  monto: z.string(),
  totalVendido: z.string(),
});

export function numeroRemito(slug: string, mes: string, id: string): string {
  return `${prefijoPanel(slug)}-R-${mes.replace("-", "")}-${id.slice(-4).toUpperCase()}`;
}

async function cargarRemito(panelId: string, id: string): Promise<Remito> {
  const db = dbPara(panelId);
  const [l, panel, negocio] = await Promise.all([
    db.liquidacionVendedor.findUnique({
      where: { id },
      select: {
        id: true,
        estado: true,
        mes: true,
        total: true,
        cantidadVentas: true,
        unidades: true,
        categorias: true,
        montoPagado: true,
        medioPago: true,
        referencia: true,
        fechaPago: true,
        firmadaAt: true,
        firmaTokenHash: true,
        firmaTokenVenceAt: true,
        firmaTokenUsadoAt: true,
        pagadaPor: { select: { nombre: true } },
        usuario: { select: { id: true, nombre: true, email: true } },
        firmas: true,
        envios: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { enviadoPor: { select: { nombre: true } } },
        },
      },
    }),
    db.panel.findUniqueOrThrow({
      where: { id: panelId },
      select: { id: true, nombre: true, slug: true, logoUrl: true },
    }),
    nombreNegocio(),
  ]);
  if (!l) throw new NotFoundError("La liquidación no existe");
  const mes = mesDeFecha(l.mes);
  const firma = (rol: RolFirmaRemito): FirmaVista | null => {
    const f = l.firmas.find((x) => x.rol === rol);
    return f
      ? {
          rol,
          nombre: f.nombre,
          usuarioId: f.usuarioId,
          firmadaAt: f.firmadaAt,
          ip: f.ip,
          medio: f.medio,
          imagen: dataUrlPng(f.imagen),
        }
      : null;
  };
  return {
    id: l.id,
    numero: numeroRemito(panel.slug, mes, l.id),
    estado: l.estado,
    mes,
    panel,
    negocio,
    vendedor: l.usuario,
    categorias: z.array(resumenSchema).parse(l.categorias),
    total: l.total.toFixed(2),
    cantidadVentas: l.cantidadVentas,
    unidades: l.unidades,
    pago:
      l.montoPagado && l.medioPago && l.fechaPago
        ? {
            monto: l.montoPagado.toFixed(2),
            medioPago: l.medioPago,
            referencia: l.referencia,
            fecha: l.fechaPago,
            registradoPor: l.pagadaPor?.nombre ?? "—",
          }
        : null,
    firmaDueno: firma(RolFirmaRemito.DUENO),
    firmaVendedor: firma(RolFirmaRemito.VENDEDOR),
    firmadaAt: l.firmadaAt,
    link: l.firmaTokenHash
      ? {
          venceAt: l.firmaTokenVenceAt,
          usadoAt: l.firmaTokenUsadoAt,
          vencido: !!l.firmaTokenVenceAt && l.firmaTokenVenceAt < ahora(),
        }
      : null,
    envios: l.envios.map((e) => ({
      id: e.id,
      tipo: e.tipo,
      destinatarios: e.destinatarios,
      enviadoPor: e.enviadoPor?.nombre ?? null,
      resultado: e.resultado,
      detalle: e.detalle,
      createdAt: e.createdAt,
    })),
  };
}

/** El remito de una liquidación (dueños, o el vendedor el suyo). null si todavía no se pagó. */
export async function obtenerRemito(ctx: CtxConUsuario, id: string): Promise<Remito | null> {
  const r = await cargarRemito(ctx.panelId, id);
  if (r.vendedor.id !== ctx.usuarioId) await exigirOwner(ctx, "El remito de otro vendedor");
  return r.estado === EstadoLiquidacion.PENDIENTE ? null : r;
}

/** Remitos pagados que el vendedor todavía no firmó (aviso en su inicio). */
export async function remitosParaFirmar(
  ctx: Ctx,
): Promise<{ id: string; mes: string; monto: string; pagadoPor: string }[]> {
  const filas = await dbPara(ctx.panelId).liquidacionVendedor.findMany({
    where: { usuarioId: ctx.usuarioId, estado: EstadoLiquidacion.PAGADA },
    orderBy: { mes: "desc" },
    select: { id: true, mes: true, montoPagado: true, pagadaPor: { select: { nombre: true } } },
  });
  return filas.map((l) => ({
    id: l.id,
    mes: mesDeFecha(l.mes),
    monto: (l.montoPagado ?? new Prisma.Decimal(0)).toFixed(2),
    pagadoPor: l.pagadaPor?.nombre ?? "",
  }));
}

// =============================================================================
// PDF
// =============================================================================

export async function pdfRemito(
  panelId: string,
  id: string,
): Promise<{ pdf: Uint8Array; archivo: string; remito: Remito }> {
  const r = await cargarRemito(panelId, id);
  if (r.estado === EstadoLiquidacion.PENDIENTE)
    throw new DomainError("La liquidación todavía no tiene el pago registrado");
  const firmaContenido = {
    v: 1,
    estado: r.estado,
    pago: r.pago,
    firmas: [r.firmaDueno, r.firmaVendedor].map((f) =>
      f ? { n: f.nombre, at: f.firmadaAt, l: f.imagen.length } : null,
    ),
    panel: r.panel,
    negocio: r.negocio,
  };
  const pdf = await pdfCacheado(clavePdf("remito-liquidacion", panelId, id, firmaContenido), () =>
    dibujarRemito(r),
  );
  return { pdf, archivo: `remito-${r.numero}.pdf`, remito: r };
}

/** PDF para la pantalla: dueños o el vendedor. */
export async function pdfRemitoParaUsuario(ctx: CtxConUsuario, id: string) {
  const r = await obtenerRemito(ctx, id);
  if (!r) throw new DomainError("La liquidación todavía no tiene el pago registrado");
  return pdfRemito(ctx.panelId, id);
}

async function dibujarRemito(r: Remito): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Remito ${r.numero}`);
  doc.setCreator(r.negocio);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const logo = await cargarLogoPanelPdf(doc, r.panel);
  const firmaDueno = r.firmaDueno ? await embedFirma(doc, r.firmaDueno.imagen) : null;
  const firmaVendedor = r.firmaVendedor ? await embedFirma(doc, r.firmaVendedor.imagen) : null;

  const ANCHO = 595.28;
  const ALTO = 841.89;
  const M = 44;
  const util = ANCHO - 2 * M;
  const negro = COLOR_PDF.texto;
  const gris = COLOR_PDF.muted;
  const fondo = COLOR_PDF.card;
  const linea = COLOR_PDF.borde;
  const page = doc.addPage([ANCHO, ALTO]);
  let y = ALTO - M;

  const texto = (
    s: string,
    x: number,
    yy: number,
    o: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      derecha?: boolean;
      centro?: boolean;
      max?: number;
    } = {},
  ) => {
    const font = o.font ?? normal;
    const size = o.size ?? 9.5;
    let w = aWinAnsi(s, font);
    if (o.max) w = recortar(w, font, size, o.max);
    const ancho = font.widthOfTextAtSize(w, size);
    const dx = o.derecha ? ancho : o.centro ? ancho / 2 : 0;
    page.drawText(w, { x: x - dx, y: yy, size, font, color: o.color ?? negro });
  };
  const raya = (yy: number, x1 = M, x2 = ANCHO - M, grosor = 0.5) =>
    page.drawLine({
      start: { x: x1, y: yy },
      end: { x: x2, y: yy },
      thickness: grosor,
      color: linea,
    });

  // Cabecera.
  const ALTO_CAB = 46;
  if (logo) {
    const e = Math.min(150 / logo.width, ALTO_CAB / logo.height);
    page.drawImage(logo, {
      x: M,
      y: y - ALTO_CAB + (ALTO_CAB - logo.height * e) / 2,
      width: logo.width * e,
      height: logo.height * e,
    });
  } else texto(r.panel.nombre, M, y - 28, { size: 18, font: negrita });
  texto(r.negocio, ANCHO - M, y - 14, { size: 11, font: negrita, derecha: true });
  texto(r.panel.nombre, ANCHO - M, y - 28, { size: 9, color: gris, derecha: true });
  y -= ALTO_CAB + 16;
  raya(y, M, ANCHO - M, 0.8);
  y -= 34;

  texto("Remito de pago", M, y, { size: 20, font: negrita });
  texto(`N° ${r.numero}`, ANCHO - M, y, { size: 11, font: mono, derecha: true });
  y -= 18;
  texto(`Ganancia por vape de ${nombreMes(r.mes)}`, M, y, { size: 11, color: gris });
  y -= 22;

  // Datos.
  const pago = r.pago!;
  const filas: [string, string][] = [
    ["Vendedor", r.vendedor.nombre],
    ["Período", nombreMes(r.mes).replace(/^./, (c) => c.toUpperCase())],
    ["Fecha del pago", formatearFecha(pago.fecha)],
    ["Medio de pago", ETIQUETA_MEDIO_PAGO[pago.medioPago]],
    ...(pago.referencia ? ([["Referencia", pago.referencia]] as [string, string][]) : []),
    ["Registró y firmó", `${pago.registradoPor} (dueño)`],
  ];
  const altoDatos = filas.length * 16 + 16;
  rectRedondeado(page, M, y - altoDatos, util, altoDatos, 8, fondo);
  let yy = y - 20;
  for (const [k, v] of filas) {
    texto(k, M + 14, yy, { size: 8.5, color: gris });
    texto(v, M + 130, yy, { size: 10, max: util - 144 });
    yy -= 16;
  }
  y -= altoDatos + 26;

  // Desglose.
  texto("Detalle de la liquidación", M, y, { size: 11, font: negrita });
  y -= 18;
  const col = { cat: M, ventas: M + 250, vapes: M + 315, tarifa: M + 400, monto: ANCHO - M };
  const enc = { size: 8, font: negrita, color: gris };
  texto("Categoría", col.cat, y, enc);
  texto("Ventas", col.ventas, y, { ...enc, derecha: true });
  texto("Vapes", col.vapes, y, { ...enc, derecha: true });
  texto("Por vape", col.tarifa, y, { ...enc, derecha: true });
  texto("Ganancia", col.monto, y, { ...enc, derecha: true });
  y -= 8;
  raya(y);
  y -= 15;
  for (const c of r.categorias) {
    const vapes = c.unidades - c.unidadesDevueltas;
    texto(ETIQUETA_CATEGORIA[c.categoria], col.cat, y, { size: 10 });
    texto(String(c.ventas), col.ventas, y, { size: 10, derecha: true });
    texto(
      c.unidadesDevueltas ? `${vapes} (${c.unidadesDevueltas} dev.)` : String(vapes),
      col.vapes,
      y,
      { size: 10, derecha: true },
    );
    texto(formatearPesos(c.tarifa), col.tarifa, y, { size: 10, derecha: true });
    texto(formatearPesos(c.monto), col.monto, y, { size: 10, derecha: true });
    y -= 8;
    raya(y);
    y -= 15;
  }
  texto("Total que le corresponde", col.cat, y, { size: 10.5, font: negrita });
  texto(
    `${r.cantidadVentas} ${r.cantidadVentas === 1 ? "venta" : "ventas"} · ${r.unidades} ${r.unidades === 1 ? "vape" : "vapes"}`,
    col.vapes,
    y,
    {
      size: 9,
      color: gris,
      derecha: true,
    },
  );
  texto(formatearPesos(r.total), col.monto, y, { size: 11, font: negrita, derecha: true });
  y -= 30;

  // Monto pagado.
  rectRedondeado(page, M, y - 46, util, 46, 8, fondo);
  texto("Monto pagado", M + 14, y - 28, { size: 11, color: gris });
  texto(formatearPesos(pago.monto), ANCHO - M - 14, y - 31, {
    size: 22,
    font: negrita,
    derecha: true,
  });
  y -= 66;
  texto(
    `Recibí de ${r.negocio} la suma de ${formatearPesos(pago.monto)} en concepto de ganancia por vape de ${nombreMes(r.mes)}.`,
    M,
    y,
    { size: 9.5, max: util },
  );

  // Firmas.
  const anchoFirma = (util - 30) / 2;
  const yBase = M + 70;
  const cajaFirma = (
    x: number,
    titulo: string,
    imagen: PDFImage | null,
    f: FirmaVista | null,
    pendiente: string,
  ) => {
    const alto = 90;
    if (imagen) {
      const e = Math.min((anchoFirma - 20) / imagen.width, alto / imagen.height);
      page.drawImage(imagen, {
        x: x + (anchoFirma - imagen.width * e) / 2,
        y: yBase + 8,
        width: imagen.width * e,
        height: imagen.height * e,
      });
    } else {
      texto(pendiente, x + anchoFirma / 2, yBase + 45, { size: 9, color: gris, centro: true });
    }
    raya(yBase, x, x + anchoFirma, 0.8);
    texto(titulo, x + anchoFirma / 2, yBase - 14, { size: 10, font: negrita, centro: true });
    if (f) {
      texto(`Firmó el ${formatearFechaHora(f.firmadaAt)}`, x + anchoFirma / 2, yBase - 27, {
        size: 8,
        color: gris,
        centro: true,
      });
      if (f.rol === RolFirmaRemito.VENDEDOR && f.ip)
        texto(`IP ${f.ip}`, x + anchoFirma / 2, yBase - 38, {
          size: 7.5,
          color: gris,
          centro: true,
        });
    }
  };
  cajaFirma(
    M,
    `${r.firmaDueno?.nombre ?? pago.registradoPor} (dueño)`,
    firmaDueno,
    r.firmaDueno,
    "Sin firma",
  );
  cajaFirma(
    M + anchoFirma + 30,
    r.vendedor.nombre,
    firmaVendedor,
    r.firmaVendedor,
    "Pendiente de firma",
  );

  // Pie.
  raya(M - 2, M, ANCHO - M, 0.4);
  const pie = aWinAnsi(
    `Remito ${r.numero} · ${r.negocio} · ${r.estado === "FIRMADA" ? "firmado por las dos partes" : "pendiente de la firma del vendedor"}`,
    normal,
  );
  page.drawText(pie, {
    x: ANCHO - M - normal.widthOfTextAtSize(pie, 7.5),
    y: M - 14,
    size: 7.5,
    font: normal,
    color: COLOR_PDF.subtle,
  });
  return doc.save();
}

async function embedFirma(doc: PDFDocument, dataUrl: string): Promise<PDFImage | null> {
  try {
    return await doc.embedPng(Buffer.from(dataUrl.split(",")[1] ?? "", "base64"));
  } catch {
    return null;
  }
}

// =============================================================================
// Mails
// =============================================================================

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

async function registrarEnvio(
  panelId: string,
  liquidacionId: string,
  tipo: TipoEnvioRemito,
  para: string[],
  enviadoPorId: string | null,
  r: ResultadoMail,
): Promise<void> {
  await transaccion({ panelId }, async (tx) => {
    await tx.envioRemito.create({
      data: {
        liquidacionId,
        tipo,
        destinatarios: para,
        enviadoPorId,
        resultado: r.estado as ResultadoEnvioMail,
        detalle: r.detalle,
        messageId: r.messageId,
      },
    });
  });
}

export interface ResultadoEnvio {
  estado: ResultadoMail["estado"];
  detalle: string | null;
  para: string[];
}

/** Al vendedor: remito firmado por el dueño + link para firmar. */
async function mandarParaFirmar(
  panelId: string,
  id: string,
  token: string,
  dueno: { id: string; nombre: string; email: string },
): Promise<ResultadoEnvio> {
  const { pdf, archivo, remito: r } = await pdfRemito(panelId, id);
  const link = urlFirma(token);
  const mes = nombreMes(r.mes);
  const monto = formatearPesos(r.pago!.monto);
  const vence = formatearFecha(new Date(ahora().getTime() + DIAS_VIGENCIA_LINK * 86_400_000));
  const asunto = `Remito de pago de ${mes} para firmar — firmado por ${dueno.nombre}`;
  const texto = [
    `Hola ${r.vendedor.nombre}:`,
    "",
    `${dueno.nombre} (dueño) te registró el pago de tu ganancia por vape de ${mes}: ${monto} (${ETIQUETA_MEDIO_PAGO[r.pago!.medioPago]}, ${formatearFecha(r.pago!.fecha)}).`,
    `El remito ya está FIRMADO POR ${dueno.nombre.toUpperCase()}, que es quien te manda este mail. Te lo adjuntamos en PDF.`,
    "",
    `Revisalo y firmalo acá (el link es personal, sirve una sola vez y vence el ${vence}):`,
    link,
    "",
    `Firmó y envió: ${dueno.nombre} (dueño) · ${dueno.email}`,
    r.negocio,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#594A42;max-width:560px">
<p>Hola ${escapar(r.vendedor.nombre)}:</p>
<p><strong>${escapar(dueno.nombre)}</strong> (dueño) te registró el pago de tu ganancia por vape de <strong>${escapar(mes)}</strong>: <strong>${escapar(monto)}</strong> (${escapar(ETIQUETA_MEDIO_PAGO[r.pago!.medioPago])}, ${escapar(formatearFecha(r.pago!.fecha))}).</p>
<p>El remito ya está <strong>firmado por ${escapar(dueno.nombre)}</strong>, que es quien te manda este mail. Te lo adjuntamos en PDF.</p>
<p><a href="${escapar(link)}" style="display:inline-block;background:#594A42;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Ver y firmar el remito</a></p>
<p style="font-size:13px;color:#6E625B">El link es personal, sirve una sola vez y vence el ${escapar(vence)}.<br>${escapar(link)}</p>
<p style="font-size:13px;color:#6E625B">Firmó y envió: <strong>${escapar(dueno.nombre)}</strong> (dueño) · ${escapar(dueno.email)}<br>${escapar(r.negocio)}</p>
</div>`;
  const para = [r.vendedor.email];
  const res = await enviarMail(
    {
      para,
      asunto,
      texto,
      html,
      responderA: dueno.email,
      adjuntos: [{ nombre: archivo, contenido: pdf, tipo: "application/pdf" }],
    },
    r.negocio,
  );
  await registrarEnvio(panelId, id, TipoEnvioRemito.PARA_FIRMAR, para, dueno.id, res);
  return { estado: res.estado, detalle: res.detalle, para };
}

/** A los dueños: el remito con las dos firmas. */
async function mandarFirmado(
  panelId: string,
  id: string,
  enviadoPorId: string | null,
): Promise<ResultadoEnvio> {
  const { pdf, archivo, remito: r } = await pdfRemito(panelId, id);
  const mes = nombreMes(r.mes);
  const fd = r.firmaDueno;
  const fv = r.firmaVendedor;
  const base = obtenerEnv().NEXT_PUBLIC_APP_URL;
  const ver = base
    ? new URL(
        rutaPanel(r.panel.slug, `/equipo/${r.vendedor.id}?mes=${r.mes}#ganancia`),
        base,
      ).toString()
    : null;
  const asunto = `${r.vendedor.nombre} firmó el remito de pago de ${mes}`;
  const texto = [
    `${r.vendedor.nombre} firmó el remito ${r.numero} del pago de ${mes} (${formatearPesos(r.pago!.monto)}).`,
    "",
    `Firma del dueño: ${fd?.nombre ?? "—"} — ${fd ? formatearFechaHora(fd.firmadaAt) : ""}`,
    `Firma de ${r.vendedor.nombre}: ${fv ? formatearFechaHora(fv.firmadaAt) : "—"}${fv?.ip ? ` (IP ${fv.ip})` : ""}`,
    "",
    "Adjuntamos el remito con las dos firmas.",
    ...(ver ? ["", `Verlo en el sistema: ${ver}`] : []),
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#594A42;max-width:560px">
<p><strong>${escapar(r.vendedor.nombre)}</strong> firmó el remito <strong>${escapar(r.numero)}</strong> del pago de ${escapar(mes)} (<strong>${escapar(formatearPesos(r.pago!.monto))}</strong>).</p>
<ul>
<li>Firma del dueño: <strong>${escapar(fd?.nombre ?? "—")}</strong> — ${escapar(fd ? formatearFechaHora(fd.firmadaAt) : "")}</li>
<li>Firma de ${escapar(r.vendedor.nombre)}: ${escapar(fv ? formatearFechaHora(fv.firmadaAt) : "—")}${fv?.ip ? ` (IP ${escapar(fv.ip)})` : ""}</li>
</ul>
<p>Adjuntamos el remito con las dos firmas.</p>
${ver ? `<p><a href="${escapar(ver)}">Verlo en el sistema</a></p>` : ""}
</div>`;
  const para = mailsDuenos();
  const res = await enviarMail(
    {
      para,
      asunto,
      texto,
      html,
      adjuntos: [{ nombre: archivo, contenido: pdf, tipo: "application/pdf" }],
    },
    r.negocio,
  );
  await registrarEnvio(panelId, id, TipoEnvioRemito.FIRMADO, para, enviadoPorId, res);
  return { estado: res.estado, detalle: res.detalle, para };
}

// =============================================================================
// Pago con firma del dueño
// =============================================================================

async function asignarToken(tx: Tx, id: string): Promise<string> {
  const { token, hash } = nuevoToken();
  await tx.liquidacionVendedor.update({
    where: { id },
    data: {
      firmaTokenHash: hash,
      firmaTokenVenceAt: new Date(ahora().getTime() + DIAS_VIGENCIA_LINK * 86_400_000),
      firmaTokenUsadoAt: null,
    },
  });
  return token;
}

export interface PagoRegistrado {
  /** Link de firma para el vendedor (para copiar o mandar por WhatsApp). */
  link: string;
  envio: ResultadoEnvio;
  vendedor: { nombre: string; email: string };
  mailConfigurado: boolean;
}

/**
 * Un dueño registra el pago FIRMANDO el remito: PENDIENTE → PAGADA, su firma,
 * link de firma para el vendedor y mail al vendedor (si está configurado).
 */
export async function registrarPagoConFirma(
  ctx: CtxConUsuario,
  id: string,
  pago: DatosPagoLiquidacion,
  firmaDataUrl: string,
): Promise<PagoRegistrado> {
  await exigirOwner(ctx, "Registrar el pago de una liquidación");
  const imagen = await procesarFirma(firmaDataUrl);
  const dueno = await dbPara(ctx.panelId).usuario.findUniqueOrThrow({
    where: { id: ctx.usuarioId },
    select: { id: true, nombre: true, email: true },
  });
  const token = await transaccion(ctx, async (tx) => {
    await registrarPagoEnTx(tx, ctx, id, pago);
    await tx.firmaRemito.create({
      data: {
        liquidacionId: id,
        rol: RolFirmaRemito.DUENO,
        usuarioId: dueno.id,
        nombre: dueno.nombre,
        imagen: Buffer.from(imagen),
        ip: ctx.meta?.ip ?? null,
        userAgent: ctx.meta?.userAgent ?? null,
        medio: "sesion",
      },
    });
    const t = await asignarToken(tx, id);
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "FirmaRemito",
      entidadId: id,
      datosDespues: { rol: "DUENO", nombre: dueno.nombre, linkVenceEnDias: DIAS_VIGENCIA_LINK },
      meta: ctx.meta,
    });
    return t;
  });
  const envio = await mandarParaFirmar(ctx.panelId, id, token, dueno);
  const r = await dbPara(ctx.panelId).liquidacionVendedor.findUniqueOrThrow({
    where: { id },
    select: { usuario: { select: { nombre: true, email: true } } },
  });
  return { link: urlFirma(token), envio, vendedor: r.usuario, mailConfigurado: mailConfigurado() };
}

/**
 * Reenviar (dueños). Pagada sin firmar: link NUEVO (el anterior deja de
 * servir) y mail al vendedor. Firmada: el remito final a los dueños.
 */
export async function reenviarRemito(
  ctx: CtxConUsuario,
  id: string,
): Promise<{ link: string | null; envio: ResultadoEnvio; mailConfigurado: boolean }> {
  await exigirOwner(ctx, "Reenviar el remito");
  const l = await dbPara(ctx.panelId).liquidacionVendedor.findUnique({
    where: { id },
    select: { estado: true },
  });
  if (!l) throw new NotFoundError("La liquidación no existe");
  if (l.estado === EstadoLiquidacion.PENDIENTE) throw new DomainError("Primero registrá el pago");
  if (l.estado === EstadoLiquidacion.FIRMADA) {
    const envio = await mandarFirmado(ctx.panelId, id, ctx.usuarioId);
    return { link: null, envio, mailConfigurado: mailConfigurado() };
  }
  const dueno = await dbPara(ctx.panelId).usuario.findUniqueOrThrow({
    where: { id: ctx.usuarioId },
    select: { id: true, nombre: true, email: true },
  });
  const token = await transaccion(ctx, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LiquidacionVendedor" WHERE "id" = ${id} AND "panelId" = ${ctx.panelId} FOR UPDATE`;
    const actual = await tx.liquidacionVendedor.findUniqueOrThrow({
      where: { id },
      select: { estado: true },
    });
    if (actual.estado !== EstadoLiquidacion.PAGADA)
      throw new DomainError("El remito ya está firmado");
    const t = await asignarToken(tx, id);
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "LiquidacionVendedor",
      entidadId: id,
      datosDespues: { linkFirma: "nuevo", venceEnDias: DIAS_VIGENCIA_LINK },
      meta: ctx.meta,
    });
    return t;
  });
  const envio = await mandarParaFirmar(ctx.panelId, id, token, dueno);
  return { link: urlFirma(token), envio, mailConfigurado: mailConfigurado() };
}

// =============================================================================
// Firma del vendedor
// =============================================================================

export type EstadoToken =
  | { estado: "VALIDO"; panelId: string; liquidacionId: string }
  | { estado: "VENCIDO" | "USADO"; panelId: string; liquidacionId: string }
  | { estado: "INVALIDO" };

/** Qué pasa con un token de firma (sin revelar nada si no existe). */
export async function estadoToken(token: string): Promise<EstadoToken> {
  if (!TOKEN_VALIDO.test(token)) return { estado: "INVALIDO" };
  const ref = await liquidacionPorTokenHash(hashToken(token));
  if (!ref) return { estado: "INVALIDO" };
  const l = await dbPara(ref.panelId).liquidacionVendedor.findUnique({
    where: { id: ref.id },
    select: { estado: true, firmaTokenVenceAt: true, firmaTokenUsadoAt: true },
  });
  if (!l) return { estado: "INVALIDO" };
  const base = { panelId: ref.panelId, liquidacionId: ref.id };
  if (l.firmaTokenUsadoAt || l.estado === EstadoLiquidacion.FIRMADA)
    return { estado: "USADO", ...base };
  if (!l.firmaTokenVenceAt || l.firmaTokenVenceAt < ahora()) return { estado: "VENCIDO", ...base };
  if (l.estado !== EstadoLiquidacion.PAGADA) return { estado: "INVALIDO" };
  return { estado: "VALIDO", ...base };
}

/** El remito que ve el vendedor en /firma/{token} (válido, o ya usado para mostrar el final). */
export async function remitoPorToken(
  token: string,
): Promise<{ estado: EstadoToken["estado"]; remito: Remito | null }> {
  const e = await estadoToken(token);
  if (e.estado === "INVALIDO") return { estado: e.estado, remito: null };
  return { estado: e.estado, remito: await cargarRemito(e.panelId, e.liquidacionId) };
}

async function firmarComoVendedor(
  panelId: string,
  id: string,
  imagen: Uint8Array,
  meta: RequestMeta | undefined,
  medio: "link" | "sesion",
  verificar: (l: {
    usuarioId: string;
    firmaTokenHash: string | null;
    firmaTokenVenceAt: Date | null;
    firmaTokenUsadoAt: Date | null;
  }) => void,
): Promise<void> {
  await transaccion({ panelId }, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LiquidacionVendedor" WHERE "id" = ${id} AND "panelId" = ${panelId} FOR UPDATE`;
    const l = await tx.liquidacionVendedor.findUnique({
      where: { id },
      select: {
        estado: true,
        usuarioId: true,
        firmaTokenHash: true,
        firmaTokenVenceAt: true,
        firmaTokenUsadoAt: true,
        usuario: { select: { nombre: true } },
      },
    });
    if (!l) throw new NotFoundError("La liquidación no existe");
    if (l.estado === EstadoLiquidacion.FIRMADA) throw new DomainError("El remito ya está firmado");
    if (l.estado !== EstadoLiquidacion.PAGADA)
      throw new DomainError("La liquidación todavía no tiene el pago registrado");
    verificar(l);
    const cuando = ahora();
    await tx.firmaRemito.create({
      data: {
        liquidacionId: id,
        rol: RolFirmaRemito.VENDEDOR,
        usuarioId: l.usuarioId,
        nombre: l.usuario.nombre,
        imagen: Buffer.from(imagen),
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
        medio,
        firmadaAt: cuando,
      },
    });
    await tx.liquidacionVendedor.update({
      where: { id },
      data: { estado: EstadoLiquidacion.FIRMADA, firmadaAt: cuando, firmaTokenUsadoAt: cuando },
    });
    await registrarAuditoria(tx, {
      usuarioId: l.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "LiquidacionVendedor",
      entidadId: id,
      datosAntes: { estado: "PAGADA" },
      datosDespues: { estado: "FIRMADA", firma: "VENDEDOR", medio },
      meta,
    });
  });
}

/** El vendedor firma desde el link público. Vencido, usado o inválido → error. */
export async function firmarConToken(
  token: string,
  firmaDataUrl: string,
  meta: RequestMeta | undefined,
): Promise<{ envio: ResultadoEnvio }> {
  const e = await estadoToken(token);
  if (e.estado === "INVALIDO") throw new NotFoundError("El link de firma no existe");
  if (e.estado === "USADO") throw new DomainError("Este remito ya se firmó");
  if (e.estado === "VENCIDO")
    throw new DomainError("El link venció: pedile a un dueño que te lo reenvíe");
  const imagen = await procesarFirma(firmaDataUrl);
  const hash = hashToken(token);
  await firmarComoVendedor(e.panelId, e.liquidacionId, imagen, meta, "link", (l) => {
    if (l.firmaTokenHash !== hash || l.firmaTokenUsadoAt)
      throw new DomainError("Este link ya no sirve: pedile a un dueño que te lo reenvíe");
    if (!l.firmaTokenVenceAt || l.firmaTokenVenceAt < ahora())
      throw new DomainError("El link venció: pedile a un dueño que te lo reenvíe");
  });
  return { envio: await mandarFirmado(e.panelId, e.liquidacionId, null) };
}

/** El vendedor firma logueado con su usuario (aviso en su inicio). */
export async function firmarDesdeSesion(
  ctx: Ctx,
  id: string,
  firmaDataUrl: string,
): Promise<{ envio: ResultadoEnvio }> {
  const imagen = await procesarFirma(firmaDataUrl);
  await firmarComoVendedor(ctx.panelId, id, imagen, ctx.meta, "sesion", (l) => {
    if (l.usuarioId !== ctx.usuarioId)
      throw new ForbiddenError("Solo el vendedor de la liquidación la firma");
  });
  return { envio: await mandarFirmado(ctx.panelId, id, ctx.usuarioId) };
}
