import "server-only";

import {
  AccionAuditoria,
  EstadoComprobante,
  MedioPago,
  Prisma,
  TipoComprobante,
} from "@prisma/client";
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { prisma, type Tx } from "@/lib/db";
import { formatearPesos } from "@/lib/format";
import { ahora } from "@/lib/reloj";
import { formatearFechaHora } from "@/lib/utils";
import { NotFoundError } from "@/server/errors";
import { aWinAnsi, envolver, MM, recortar } from "@/server/pdf";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";
import { nombreCompleto } from "@/server/services/producto.service";
import { claveAleatoria, claveDeUrl, storage } from "@/server/storage";

/**
 * COMPROBANTES
 *
 * Numeración: `SecuenciaComprobante` por (tipo, punto de venta), bloqueada con
 * SELECT … FOR UPDATE dentro de la MISMA transacción que confirma la venta.
 * Dos ventas simultáneas se ordenan en esa fila: la segunda espera, lee el
 * número ya incrementado y toma el siguiente. Si la venta falla (stock, pago),
 * el incremento se revierte con ella: sin huecos ni duplicados. La DB además
 * rechaza números que la secuencia no asignó y la unicidad (tipo, PV, número).
 *
 * AFIP (factura electrónica) — NO integrado todavía. Se enchufa acá:
 *   1. Para FACTURA_A/B/C, en vez de (o además de) la secuencia local, pedir el
 *      próximo número a WSFE (FECompUltimoAutorizado) y solicitar el CAE con
 *      FECAESolicitar, FUERA de la transacción de la venta (es un servicio
 *      externo lento): confirmar la venta → emitir comprobante "pendiente de CAE"
 *      → job que obtiene el CAE y completa `cae` / `caeVencimiento` (la DB ya
 *      permite asignarlos una sola vez).
 *   2. Agregar al PDF el QR de AFIP (RG 4892) con los datos del CAE.
 */

export const ETIQUETA_COMPROBANTE: Record<TipoComprobante, string> = {
  TICKET: "Ticket",
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  FACTURA_C: "Factura C",
  PRESUPUESTO: "Presupuesto",
};

export const ETIQUETA_MEDIO_PAGO: Record<MedioPago, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  DEBITO: "Débito",
  CREDITO: "Crédito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
  CREDITO_CLIENTE: "Saldo a favor",
};

export function numeroComprobante(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
}

/**
 * Reserva el próximo número de (tipo, puntoVenta) con SELECT … FOR UPDATE.
 * Debe llamarse en la MISMA transacción que inserta el Comprobante: si esa
 * transacción hace rollback, el número no se consume (sin huecos).
 */
export async function siguienteNumeroComprobante(
  tx: Tx,
  tipo: TipoComprobante,
  puntoVenta = 1,
): Promise<number> {
  const bloquear = () => tx.$queryRaw<{ id: string; ultimoNumero: number }[]>`
    SELECT "id", "ultimoNumero" FROM "SecuenciaComprobante"
    WHERE "tipo" = ${tipo}::"TipoComprobante" AND "puntoVenta" = ${puntoVenta}
    FOR UPDATE
  `;
  let [secuencia] = await bloquear();
  if (!secuencia) {
    // Primer comprobante de ese tipo en ese punto de venta: se crea la fila (tolera creación concurrente).
    await tx.secuenciaComprobante.createMany({
      data: [{ tipo, puntoVenta, ultimoNumero: 0 }],
      skipDuplicates: true,
    });
    [secuencia] = await bloquear();
  }
  if (!secuencia) throw new Error(`No se pudo obtener la secuencia de ${tipo} PV ${puntoVenta}.`);
  const actualizada = await tx.secuenciaComprobante.update({
    where: { id: secuencia.id },
    data: { ultimoNumero: secuencia.ultimoNumero + 1 },
    select: { ultimoNumero: true },
  });
  return actualizada.ultimoNumero;
}

/**
 * Emite el comprobante de una venta ya CONFIRMADA, dentro de su transacción.
 * El número sale de la secuencia bloqueada con FOR UPDATE (ver arriba).
 */
export async function emitirComprobante(
  tx: Tx,
  ventaId: string,
  tipo: TipoComprobante,
  actor: Actor,
  puntoVenta = 1,
): Promise<{ id: string; tipo: TipoComprobante; puntoVenta: number; numero: number }> {
  const venta = await tx.venta.findUnique({
    where: { id: ventaId },
    select: {
      total: true,
      numero: true,
      cliente: { select: { nombre: true, apellido: true, documento: true } },
    },
  });
  if (!venta) throw new NotFoundError("La venta no existe");

  const numero = await siguienteNumeroComprobante(tx, tipo, puntoVenta);
  const razonSocial = venta.cliente
    ? [venta.cliente.nombre, venta.cliente.apellido].filter(Boolean).join(" ")
    : null;
  const comprobante = await tx.comprobante.create({
    data: {
      ventaId,
      tipo,
      puntoVenta,
      numero,
      total: venta.total,
      razonSocial,
      cuit: venta.cliente?.documento ?? null,
      fecha: ahora(),
    },
  });
  await registrarAuditoria(tx, {
    usuarioId: actor.id,
    accion: AccionAuditoria.CREATE,
    entidad: "Comprobante",
    entidadId: comprobante.id,
    datosDespues: {
      ventaNumero: venta.numero,
      tipo,
      puntoVenta,
      numero,
      total: venta.total.toFixed(2),
    },
    meta: actor.meta,
  });
  return { id: comprobante.id, tipo, puntoVenta, numero };
}

/** Marca ANULADO el comprobante de una venta que se anula (dentro de su transacción). */
export async function anularComprobanteDeVenta(
  tx: Tx,
  ventaId: string,
  actor: Actor,
): Promise<void> {
  const c = await tx.comprobante.findUnique({ where: { ventaId } });
  if (!c || c.estado === EstadoComprobante.ANULADO) return;
  // pdfUrl en null: el próximo PDF se regenera con la marca "ANULADO".
  await tx.comprobante.update({
    where: { id: c.id },
    data: { estado: EstadoComprobante.ANULADO, anuladoAt: ahora(), pdfUrl: null },
  });
  await registrarAuditoria(tx, {
    usuarioId: actor.id,
    accion: AccionAuditoria.UPDATE,
    entidad: "Comprobante",
    entidadId: c.id,
    datosAntes: { estado: c.estado },
    datosDespues: { estado: EstadoComprobante.ANULADO },
    meta: actor.meta,
  });
}

// =============================================================================
// PDF
// =============================================================================

export type FormatoComprobante = "ticket" | "a4";

async function datosComprobante(id: string) {
  const c = await prisma.comprobante.findUnique({
    where: { id },
    include: {
      venta: {
        include: {
          cliente: { select: { nombre: true, apellido: true, documento: true, telefono: true } },
          usuario: { select: { nombre: true } },
          deposito: { select: { nombre: true } },
          items: {
            orderBy: { createdAt: "asc" },
            include: {
              variante: {
                select: {
                  nombre: true,
                  producto: { select: { nombre: true, tieneVariantes: true } },
                },
              },
            },
          },
          pagos: { where: { anulado: false }, orderBy: { fecha: "asc" } },
        },
      },
    },
  });
  if (!c) throw new NotFoundError("El comprobante no existe");
  return c;
}

type Datos = Awaited<ReturnType<typeof datosComprobante>>;
type Config = Awaited<ReturnType<typeof obtenerConfigVentas>>;

async function cargarLogo(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const tipo = res.headers.get("content-type") ?? "";
    if (tipo.includes("png") || url.toLowerCase().endsWith(".png"))
      return await doc.embedPng(bytes);
    return await doc.embedJpg(bytes);
  } catch {
    return null; // sin logo antes que sin comprobante
  }
}

/** Filas del comprobante, independientes del formato (ticket o A4). */
function contenido(c: Datos, config: Config) {
  const v = c.venta;
  const $ = (d: Prisma.Decimal | number) =>
    formatearPesos(typeof d === "number" ? d : d.toFixed(2));
  const cliente = v.cliente
    ? [
        [v.cliente.nombre, v.cliente.apellido].filter(Boolean).join(" "),
        v.cliente.documento ? `Doc. ${v.cliente.documento}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  return {
    negocio: [
      config.nombreNegocio,
      config.cuit ? `CUIT ${config.cuit}` : "",
      config.direccion,
      config.telefono,
    ].filter(Boolean),
    titulo: `${ETIQUETA_COMPROBANTE[c.tipo]} N° ${numeroComprobante(c.puntoVenta, c.numero)}`,
    datos: [
      `Fecha: ${formatearFechaHora(v.fecha)}`,
      `Venta #${v.numero} · Vendedor: ${v.usuario.nombre}`,
      ...(cliente ? [`Cliente: ${cliente}`] : []),
    ],
    items: v.items.map((i) => ({
      nombre: nombreCompleto(
        i.variante.producto.nombre,
        i.variante.nombre,
        i.variante.producto.tieneVariantes,
      ),
      detalle: `${i.cantidad} x ${$(i.precioUnitario)}`,
      subtotal: $(i.subtotal),
    })),
    totales: [
      ...(v.descuento.greaterThan(0) || !v.redondeo.isZero() ? [["Subtotal", $(v.subtotal)]] : []),
      ...(v.descuento.greaterThan(0) ? [["Descuento", `-${$(v.descuento)}`]] : []),
      ...(!v.redondeo.isZero() ? [["Redondeo", $(v.redondeo)]] : []),
    ] as [string, string][],
    total: $(v.total),
    pagos: v.pagos.map(
      (p) =>
        [
          `${ETIQUETA_MEDIO_PAGO[p.medioPago]}${p.referencia ? ` (${p.referencia})` : ""}`,
          $(p.monto),
        ] as [string, string],
    ),
    saldo: v.saldoPendiente.greaterThan(0) ? $(v.saldoPendiente) : null,
    leyenda:
      c.tipo === TipoComprobante.TICKET || c.tipo === TipoComprobante.PRESUPUESTO
        ? config.leyenda
        : "",
    anulado: c.estado === EstadoComprobante.ANULADO,
  };
}

interface Fuentes {
  normal: PDFFont;
  negrita: PDFFont;
}

/**
 * Motor de dibujo mínimo: una lista de renglones que se mide primero (el
 * ticket térmico tiene alto variable) y se dibuja después.
 */
type Renglon =
  | { t: "texto"; texto: string; tam: number; negrita?: boolean; centro?: boolean }
  | { t: "par"; izq: string; der: string; tam: number; negrita?: boolean }
  | { t: "sep" }
  | { t: "esp"; alto: number };

function altoRenglon(r: Renglon): number {
  if (r.t === "sep") return 6;
  if (r.t === "esp") return r.alto;
  return r.tam * 1.35;
}

function dibujar(
  page: PDFPage,
  renglones: Renglon[],
  x0: number,
  ancho: number,
  yInicio: number,
  f: Fuentes,
) {
  let y = yInicio;
  for (const r of renglones) {
    const alto = altoRenglon(r);
    if (r.t === "texto") {
      const fuente = r.negrita ? f.negrita : f.normal;
      const texto = recortar(aWinAnsi(r.texto, fuente), fuente, r.tam, ancho);
      const w = fuente.widthOfTextAtSize(texto, r.tam);
      page.drawText(texto, {
        x: r.centro ? x0 + (ancho - w) / 2 : x0,
        y: y - r.tam,
        size: r.tam,
        font: fuente,
        color: rgb(0, 0, 0),
      });
    } else if (r.t === "par") {
      const fuente = r.negrita ? f.negrita : f.normal;
      const der = aWinAnsi(r.der, fuente);
      const wDer = fuente.widthOfTextAtSize(der, r.tam);
      const izq = recortar(aWinAnsi(r.izq, fuente), fuente, r.tam, ancho - wDer - 6);
      page.drawText(izq, { x: x0, y: y - r.tam, size: r.tam, font: fuente });
      page.drawText(der, { x: x0 + ancho - wDer, y: y - r.tam, size: r.tam, font: fuente });
    } else if (r.t === "sep") {
      page.drawLine({
        start: { x: x0, y: y - 3 },
        end: { x: x0 + ancho, y: y - 3 },
        thickness: 0.5,
        color: rgb(0.4, 0.4, 0.4),
        dashArray: [2, 2],
      });
    }
    y -= alto;
  }
}

function renglones(
  k: ReturnType<typeof contenido>,
  f: Fuentes,
  ancho: number,
  escala: number,
): Renglon[] {
  const s = (n: number) => n * escala;
  const r: Renglon[] = [];
  k.negocio.forEach((l, i) =>
    r.push({ t: "texto", texto: l, tam: i === 0 ? s(11) : s(7.5), negrita: i === 0, centro: true }),
  );
  r.push({ t: "sep" }, { t: "texto", texto: k.titulo, tam: s(9), negrita: true, centro: true });
  k.datos.forEach((d) => r.push({ t: "texto", texto: d, tam: s(7.5) }));
  r.push({ t: "sep" });
  for (const it of k.items) {
    for (const linea of envolver(aWinAnsi(it.nombre, f.normal), f.normal, s(8), ancho))
      r.push({ t: "texto", texto: linea, tam: s(8) });
    r.push({ t: "par", izq: `  ${it.detalle}`, der: it.subtotal, tam: s(8) });
  }
  r.push({ t: "sep" });
  k.totales.forEach(([a, b]) => r.push({ t: "par", izq: a, der: b, tam: s(8) }));
  r.push({ t: "par", izq: "TOTAL", der: k.total, tam: s(11), negrita: true });
  if (k.pagos.length) {
    r.push({ t: "esp", alto: s(3) }, { t: "texto", texto: "Pagos", tam: s(7.5), negrita: true });
    k.pagos.forEach(([a, b]) => r.push({ t: "par", izq: a, der: b, tam: s(7.5) }));
  }
  if (k.saldo)
    r.push({
      t: "par",
      izq: "Saldo pendiente (cuenta corriente)",
      der: k.saldo,
      tam: s(8),
      negrita: true,
    });
  if (k.leyenda) {
    r.push({ t: "sep" });
    for (const l of envolver(aWinAnsi(k.leyenda, f.normal), f.normal, s(7), ancho))
      r.push({ t: "texto", texto: l, tam: s(7), centro: true });
  }
  r.push({ t: "texto", texto: "¡Gracias por su compra!", tam: s(7.5), centro: true });
  return r;
}

export async function generarPdfComprobante(
  id: string,
  formato: FormatoComprobante,
): Promise<Uint8Array> {
  const [c, config] = await Promise.all([datosComprobante(id), obtenerConfigVentas()]);
  const doc = await PDFDocument.create();
  doc.setTitle(`${ETIQUETA_COMPROBANTE[c.tipo]} ${numeroComprobante(c.puntoVenta, c.numero)}`);
  doc.setCreator(config.nombreNegocio);
  const f: Fuentes = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const logo = await cargarLogo(doc, config.logoUrl);
  const k = contenido(c, config);

  // Ticket: 80 mm de papel (72 mm imprimibles), alto según el contenido. A4: 210 × 297 mm.
  const ancho = formato === "ticket" ? 80 * MM : 210 * MM;
  const margen = formato === "ticket" ? 4 * MM : 20 * MM;
  const util = ancho - 2 * margen;
  const lista = renglones(k, f, util, formato === "ticket" ? 1 : 1.3);
  const altoLogo = logo ? Math.min(18 * MM, (util * 0.4 * logo.height) / logo.width) : 0;
  const altoContenido =
    lista.reduce((a, r) => a + altoRenglon(r), 0) + altoLogo + 2 * margen + (logo ? 4 : 0);
  const alto = formato === "ticket" ? altoContenido : 297 * MM;
  const page = doc.addPage([ancho, alto]);

  let y = alto - margen;
  if (logo) {
    const w = (altoLogo * logo.width) / logo.height;
    page.drawImage(logo, { x: (ancho - w) / 2, y: y - altoLogo, width: w, height: altoLogo });
    y -= altoLogo + 4;
  }
  dibujar(page, lista, margen, util, y, f);

  if (k.anulado) {
    const tam = formato === "ticket" ? 36 : 90;
    page.drawText("ANULADO", {
      x: ancho * 0.12,
      y: alto * 0.4,
      size: tam,
      font: f.negrita,
      color: rgb(0.85, 0.1, 0.1),
      opacity: 0.35,
      rotate: degrees(35),
    });
  }
  return doc.save();
}

/**
 * PDF del comprobante. El ticket se cachea en el storage (`pdfUrl`): es el
 * que se comparte por WhatsApp. El A4 se genera cada vez.
 */
export async function obtenerPdfComprobante(
  id: string,
  formato: FormatoComprobante = "ticket",
): Promise<{ pdf: Uint8Array; url: string | null; nombre: string }> {
  const c = await prisma.comprobante.findUnique({
    where: { id },
    select: { pdfUrl: true, tipo: true, puntoVenta: true, numero: true },
  });
  if (!c) throw new NotFoundError("El comprobante no existe");
  const nombre = `${ETIQUETA_COMPROBANTE[c.tipo].toLowerCase().replace(/\s+/g, "-")}-${numeroComprobante(c.puntoVenta, c.numero)}.pdf`;
  if (formato === "a4") return { pdf: await generarPdfComprobante(id, "a4"), url: null, nombre };

  const clave = c.pdfUrl ? claveDeUrl(c.pdfUrl) : null;
  const guardado = clave ? await storage.leer(clave) : null;
  if (guardado && c.pdfUrl) return { pdf: guardado.datos, url: c.pdfUrl, nombre };

  const pdf = await generarPdfComprobante(id, "ticket");
  const url = await storage.guardar(
    claveAleatoria("comprobantes", `comprobante-${c.numero}`, "pdf"),
    pdf,
    "application/pdf",
  );
  await prisma.comprobante.update({ where: { id }, data: { pdfUrl: url } });
  return { pdf, url, nombre };
}
