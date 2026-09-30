import { AccionAuditoria, EstadoTransferencia, Prisma } from "@prisma/client";
import {
  PDFDocument,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type rgb,
} from "pdf-lib";

import { logosCandidatos } from "@/lib/paneles";
import { formatearFechaHora } from "@/lib/utils";
import { formatearIdTransferencia, type CrearTransferencia } from "@/lib/validations/transferencia";
import { nombreConSabor, saborVisible } from "@/lib/ventas-ui";
import { siguienteNumero } from "@/server/db/secuencia";
import { dbPara, enTransaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, NotFoundError, StockInsuficienteError } from "@/server/errors";
import { logger } from "@/server/log";
import {
  aWinAnsi,
  cargarLogoPdf,
  COLOR_PDF,
  envolver,
  rectRedondeado,
  recortar,
} from "@/server/pdf";
import { registrarAuditoria } from "@/server/services/audit.service";
import { nombreNegocio } from "@/server/services/identidad.service";
import {
  bloquearStock,
  movimientos,
  transferirStock,
  type MovimientoListado,
} from "@/server/services/stock.service";
import { claveAleatoria, obtenerStorage, urlCompartible } from "@/server/storage";

/**
 * TRANSFERENCIAS entre galpones (depósitos) de UN panel.
 *
 * - "Mover ahora" → crearYCompletarTransferencia: una transacción Serializable
 *   crea el documento (código VAP-T-000001) y mueve el stock (SALIDA en origen
 *   + ENTRADA en destino por sabor, vía transferirStock). Si un sabor no
 *   alcanza, falla entera con el detalle y no queda nada.
 * - "Registrar envío, confirmar al recibir" → crearTransferencia (PENDIENTE,
 *   no mueve nada) + completarTransferencia cuando llega la mercadería.
 * - Remito PDF (generarRemito): se genera al crear y queda en `remitoUrl`.
 *
 * Regla de oro: el stock SOLO cambia vía transferirStock (motor de stock).
 * Todo recibe `ctx` primero: lecturas con dbPara(ctx.panelId), escrituras en
 * una transacción del panel. Un depósito o sabor de otro panel da "no existe".
 * Los permisos (STOCK crear/editar/eliminar) se exigen en las actions.
 */

// =============================================================================
// Helpers
// =============================================================================

async function depositoActivo(tx: Tx, id: string, rol = "El galpón") {
  const d = await tx.deposito.findUnique({
    where: { id },
    select: { id: true, nombre: true, activo: true },
  });
  if (!d) throw new NotFoundError(`${rol} no existe`);
  if (!d.activo) throw new DomainError(`${rol} "${d.nombre}" está inactivo`);
  return d;
}

/** Sabores vivos del panel (con su producto): NotFound si alguno no existe o está dado de baja. */
async function variantesVivas(tx: Tx, ids: string[]) {
  const vs = await tx.variante.findMany({
    where: { id: { in: ids }, deletedAt: null, producto: { deletedAt: null } },
    select: {
      id: true,
      nombre: true,
      productoId: true,
      producto: { select: { nombreCompleto: true } },
    },
  });
  if (vs.length !== new Set(ids).size)
    throw new NotFoundError("Alguno de los productos no existe o fue dado de baja");
  return new Map(
    vs.map((v) => [
      v.id,
      { ...v, nombreCompleto: nombreConSabor(v.producto.nombreCompleto, v.nombre) },
    ]),
  );
}

/** Ordenar por varianteId: todas las operaciones bloquean filas de Stock en el mismo orden (sin deadlocks). */
const porVariante = <T extends { varianteId: string }>(items: T[]) =>
  [...items].sort((a, b) => a.varianteId.localeCompare(b.varianteId));

/** "Producto — sabor: hay X, se piden Y" por cada sabor que no alcanza en el depósito. */
async function faltantes(
  tx: Tx,
  depositoId: string,
  items: { varianteId: string; cantidad: number }[],
  nombres: Map<string, { nombreCompleto: string }>,
): Promise<string[]> {
  const stocks = await tx.stock.findMany({
    where: { depositoId, varianteId: { in: items.map((i) => i.varianteId) } },
    select: { varianteId: true, cantidad: true },
  });
  const disp = new Map(stocks.map((s) => [s.varianteId, s.cantidad]));
  return items
    .filter((i) => (disp.get(i.varianteId) ?? 0) < i.cantidad)
    .map(
      (i) =>
        `${nombres.get(i.varianteId)?.nombreCompleto ?? i.varianteId}: hay ${disp.get(i.varianteId) ?? 0}, se piden ${i.cantidad}`,
    );
}

/** Bloquea la fila de la transferencia (SQL cruda: filtra el panel a mano). */
async function bloquearTransferencia(ctx: Ctx, tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "Transferencia"
    WHERE "id" = ${id} AND "panelId" = ${ctx.panelId}
    FOR UPDATE`;
}

// =============================================================================
// Escrituras
// =============================================================================

export interface TransferenciaCreada {
  id: string;
  numero: number;
  codigo: string;
}

/**
 * Crea la transferencia PENDIENTE con el próximo número y código del panel.
 * Valida que HOY haya stock en origen (solo valida: no mueve nada hasta
 * completarla). Origen y destino tienen que ser depósitos activos del panel.
 */
export async function crearTransferencia(
  ctx: Ctx,
  input: CrearTransferencia,
  txExterna?: Tx,
): Promise<TransferenciaCreada> {
  return enTransaccion(ctx, txExterna, async (tx) => {
    if (input.depositoOrigenId === input.depositoDestinoId)
      throw new DomainError("El galpón de destino tiene que ser distinto al de origen");
    const origen = await depositoActivo(tx, input.depositoOrigenId, "El galpón de origen");
    await depositoActivo(tx, input.depositoDestinoId, "El galpón de destino");
    const variantes = await variantesVivas(
      tx,
      input.items.map((i) => i.varianteId),
    );
    const sinStock = await faltantes(tx, input.depositoOrigenId, input.items, variantes);
    if (sinStock.length) {
      throw new DomainError(
        `Stock insuficiente en ${origen.nombre}. ${sinStock.join(" · ")}`,
        "STOCK_INSUFICIENTE",
        409,
      );
    }
    const [numero, panel] = await Promise.all([
      siguienteNumero(tx, ctx.panelId, "TRANSFERENCIA"),
      tx.panel.findUniqueOrThrow({ where: { id: ctx.panelId }, select: { slug: true } }),
    ]);
    const codigo = formatearIdTransferencia(panel.slug, numero);
    const t = await tx.transferencia.create({
      data: {
        numero,
        codigo,
        depositoOrigenId: input.depositoOrigenId,
        depositoDestinoId: input.depositoDestinoId,
        estado: EstadoTransferencia.PENDIENTE,
        fecha: input.fecha ?? new Date(),
        observacion: input.observacion ?? null,
        usuarioId: ctx.usuarioId,
        items: {
          create: porVariante(input.items).map((i) => ({
            varianteId: i.varianteId,
            productoId: variantes.get(i.varianteId)!.productoId,
            cantidad: i.cantidad,
          })),
        },
      },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.CREATE,
      entidad: "Transferencia",
      entidadId: t.id,
      datosDespues: {
        codigo,
        origen: input.depositoOrigenId,
        destino: input.depositoDestinoId,
        observacion: input.observacion ?? null,
        items: input.items.map((i) => ({ varianteId: i.varianteId, cantidad: i.cantidad })),
      },
      meta: ctx.meta,
    });
    return { id: t.id, numero, codigo };
  });
}

/**
 * Completa la transferencia (la mercadería llegó): por cada ítem,
 * transferirStock (SALIDA + ENTRADA). Transacción Serializable del panel. Si
 * falta stock en cualquier ítem, falla completa con el detalle de todos los
 * faltantes y queda PENDIENTE.
 */
export async function completarTransferencia(
  ctx: Ctx,
  id: string,
  txExterna?: Tx,
): Promise<{ numero: number; codigo: string; unidades: number }> {
  return enTransaccion(
    ctx,
    txExterna,
    async (tx) => {
      // Bloquea la transferencia: dos "Confirmar recepción" simultáneos no la aplican dos veces.
      await bloquearTransferencia(ctx, tx, id);
      const t = await tx.transferencia.findUnique({ where: { id }, include: { items: true } });
      if (!t) throw new NotFoundError("La transferencia no existe");
      if (t.estado !== EstadoTransferencia.PENDIENTE) {
        throw new DomainError(
          `La transferencia ${t.codigo} está ${t.estado.toLowerCase()}: solo se completan las pendientes.`,
        );
      }
      const origen = await depositoActivo(tx, t.depositoOrigenId, "El galpón de origen");
      await depositoActivo(tx, t.depositoDestinoId, "El galpón de destino");
      const items = porVariante(t.items);
      const variantes = await variantesVivas(
        tx,
        items.map((i) => i.varianteId),
      );

      // Bloquear todo primero (orden fijo) y reportar todos los faltantes juntos.
      for (const i of items)
        await bloquearStock(tx, ctx.panelId, i.varianteId, [
          t.depositoOrigenId,
          t.depositoDestinoId,
        ]);
      const sinStock = await faltantes(tx, t.depositoOrigenId, items, variantes);
      if (sinStock.length) {
        throw new DomainError(
          `No se pudo completar la transferencia ${t.codigo}: stock insuficiente en ${origen.nombre}. ${sinStock.join(" · ")}. Sigue pendiente.`,
          "STOCK_INSUFICIENTE",
          409,
        );
      }

      try {
        for (const i of items) {
          await transferirStock(tx, {
            varianteId: i.varianteId,
            depositoOrigenId: t.depositoOrigenId,
            depositoDestinoId: t.depositoDestinoId,
            cantidad: i.cantidad,
            usuarioId: ctx.usuarioId,
            motivo: `Transferencia ${t.codigo}`,
            referenciaId: t.id,
          });
        }
      } catch (e) {
        if (e instanceof StockInsuficienteError) {
          throw new DomainError(
            `No se pudo completar la transferencia ${t.codigo}: ${e.message}. Sigue pendiente.`,
            "STOCK_INSUFICIENTE",
            409,
          );
        }
        throw e;
      }

      await tx.transferencia.update({
        where: { id },
        data: { estado: EstadoTransferencia.COMPLETADA, completadaAt: new Date() },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Transferencia",
        entidadId: id,
        datosAntes: { estado: "PENDIENTE" },
        datosDespues: { estado: "COMPLETADA" },
        meta: ctx.meta,
      });
      return {
        numero: t.numero,
        codigo: t.codigo,
        unidades: items.reduce((a, i) => a + i.cantidad, 0),
      };
    },
    { timeout: 60_000, maxRetries: 2 },
  );
}

export interface TransferenciaMovida extends TransferenciaCreada {
  unidades: number;
  /** Referencia del remito en el storage; null si no se pudo generar (se puede reintentar). */
  remitoUrl: string | null;
}

/**
 * "Mover ahora": crea la transferencia y la completa en el acto, todo en UNA
 * transacción Serializable (si un sabor no alcanza, no queda ni el documento
 * ni un movimiento). Después genera el remito PDF; si el remito falla, la
 * transferencia igual queda hecha y el remito se puede generar después.
 */
export async function crearYCompletarTransferencia(
  ctx: Ctx,
  input: CrearTransferencia,
): Promise<TransferenciaMovida> {
  const r = await enTransaccion(
    ctx,
    undefined,
    async (tx) => {
      const creada = await crearTransferencia(ctx, input, tx);
      const { unidades } = await completarTransferencia(ctx, creada.id, tx);
      return { ...creada, unidades };
    },
    { timeout: 60_000, maxRetries: 2 },
  );
  return { ...r, remitoUrl: await remitoSinFallar(ctx, r.id) };
}

/**
 * "Registrar envío, confirmar al recibir": la transferencia queda PENDIENTE
 * (no mueve stock) con su remito para que viaje con la mercadería.
 */
export async function registrarEnvioTransferencia(
  ctx: Ctx,
  input: CrearTransferencia,
): Promise<TransferenciaMovida> {
  const creada = await crearTransferencia(ctx, input);
  const unidades = input.items.reduce((a, i) => a + i.cantidad, 0);
  return { ...creada, unidades, remitoUrl: await remitoSinFallar(ctx, creada.id) };
}

async function remitoSinFallar(ctx: Ctx, id: string): Promise<string | null> {
  try {
    return (await generarRemito(ctx, id)).url;
  } catch (e) {
    logger().warn({ err: e, transferenciaId: id }, "no se pudo generar el remito");
    return null;
  }
}

/** Anula una transferencia PENDIENTE (no movió stock, no hay nada que revertir). */
export async function anularTransferencia(
  ctx: Ctx,
  id: string,
  motivo: string,
  txExterna?: Tx,
): Promise<{ numero: number; codigo: string }> {
  return enTransaccion(ctx, txExterna, async (tx) => {
    await bloquearTransferencia(ctx, tx, id);
    const t = await tx.transferencia.findUnique({ where: { id } });
    if (!t) throw new NotFoundError("La transferencia no existe");
    if (t.estado !== EstadoTransferencia.PENDIENTE) {
      throw new DomainError(
        `La transferencia ${t.codigo} está ${t.estado.toLowerCase()}: solo se anulan las pendientes.`,
      );
    }
    const observacion = [t.observacion, `[Anulada] ${motivo}`].filter(Boolean).join("\n");
    await tx.transferencia.update({
      where: { id },
      data: { estado: EstadoTransferencia.ANULADA, observacion },
    });
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Transferencia",
      entidadId: id,
      datosAntes: { estado: "PENDIENTE" },
      datosDespues: { estado: "ANULADA", motivo },
      meta: ctx.meta,
    });
    return { numero: t.numero, codigo: t.codigo };
  });
}

// =============================================================================
// Lecturas
// =============================================================================

export interface TransferenciaListada {
  id: string;
  numero: number;
  codigo: string;
  fecha: Date;
  estado: EstadoTransferencia;
  origen: string;
  destino: string;
  items: number;
  unidades: number;
  usuario: string;
  completadaAt: Date | null;
  remitoUrl: string | null;
}

/** Transferencias del panel; con `depositoId`, las que salen o entran a ese depósito. */
export async function listarTransferencias(
  ctx: Ctx,
  filtros: {
    estado?: EstadoTransferencia;
    depositoId?: string;
    page: number;
    pageSize: number;
  },
): Promise<{
  transferencias: TransferenciaListada[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = dbPara(ctx.panelId);
  const where: Prisma.TransferenciaWhereInput = {
    ...(filtros.estado ? { estado: filtros.estado } : {}),
    ...(filtros.depositoId
      ? {
          OR: [{ depositoOrigenId: filtros.depositoId }, { depositoDestinoId: filtros.depositoId }],
        }
      : {}),
  };
  const [total, filas] = await Promise.all([
    db.transferencia.count({ where }),
    db.transferencia.findMany({
      where,
      orderBy: [{ numero: "desc" }],
      skip: (filtros.page - 1) * filtros.pageSize,
      take: filtros.pageSize,
      include: {
        depositoOrigen: { select: { nombre: true } },
        depositoDestino: { select: { nombre: true } },
        usuario: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
  ]);
  return {
    transferencias: filas.map((t) => ({
      id: t.id,
      numero: t.numero,
      codigo: t.codigo,
      fecha: t.fecha,
      estado: t.estado,
      origen: t.depositoOrigen.nombre,
      destino: t.depositoDestino.nombre,
      items: t.items.length,
      unidades: t.items.reduce((a, i) => a + i.cantidad, 0),
      usuario: t.usuario.nombre,
      completadaAt: t.completadaAt,
      remitoUrl: t.remitoUrl,
    })),
    total,
    page: filtros.page,
    pageSize: filtros.pageSize,
  };
}

export interface ItemTransferenciaDetalle {
  varianteId: string;
  productoId: string;
  /** "Producto — sabor". */
  nombre: string;
  marca: string;
  modelo: string;
  /** Pitadas en Vapes (Panel.etiquetaEspecificacion). */
  especificacion: string;
  /** null si el producto no tiene sabores. */
  sabor: string | null;
  sku: string;
  cantidad: number;
  /** Stock actual del sabor en el galpón de origen. */
  stockOrigen: number;
}

export interface TransferenciaDetalle extends Omit<TransferenciaListada, "items"> {
  depositoOrigenId: string;
  depositoDestinoId: string;
  observacion: string | null;
  items: ItemTransferenciaDetalle[];
}

export async function obtenerTransferencia(ctx: Ctx, id: string): Promise<TransferenciaDetalle> {
  const t = await dbPara(ctx.panelId).transferencia.findUnique({
    where: { id },
    include: {
      depositoOrigen: { select: { nombre: true } },
      depositoDestino: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
      items: {
        include: {
          variante: {
            select: {
              nombre: true,
              sku: true,
              stocks: { select: { depositoId: true, cantidad: true } },
            },
          },
          producto: {
            select: {
              nombre: true,
              nombreCompleto: true,
              especificacion: true,
              marca: { select: { nombre: true } },
            },
          },
        },
      },
    },
  });
  if (!t) throw new NotFoundError("La transferencia no existe");
  const items = t.items
    .map((i) => ({
      varianteId: i.varianteId,
      productoId: i.productoId,
      nombre: nombreConSabor(i.producto.nombreCompleto, i.variante.nombre),
      marca: i.producto.marca.nombre,
      modelo: i.producto.nombre,
      especificacion: i.producto.especificacion,
      sabor: saborVisible(i.variante.nombre),
      sku: i.variante.sku,
      cantidad: i.cantidad,
      stockOrigen:
        i.variante.stocks.find((s) => s.depositoId === t.depositoOrigenId)?.cantidad ?? 0,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return {
    id: t.id,
    numero: t.numero,
    codigo: t.codigo,
    fecha: t.fecha,
    estado: t.estado,
    origen: t.depositoOrigen.nombre,
    destino: t.depositoDestino.nombre,
    depositoOrigenId: t.depositoOrigenId,
    depositoDestinoId: t.depositoDestinoId,
    usuario: t.usuario.nombre,
    completadaAt: t.completadaAt,
    observacion: t.observacion,
    remitoUrl: t.remitoUrl,
    unidades: items.reduce((a, i) => a + i.cantidad, 0),
    items,
  };
}

/** Movimientos del ledger que generó la transferencia (SALIDA + ENTRADA por sabor). */
export async function movimientosDeTransferencia(
  ctx: Ctx,
  id: string,
): Promise<MovimientoListado[]> {
  const r = await movimientos(ctx, {
    referenciaTipo: "TRANSFERENCIA",
    referenciaId: id,
    pageSize: 200,
  });
  return r.movimientos;
}

/**
 * Texto para mandar por WhatsApp (sin destinatario: se elige en WhatsApp):
 * código, origen → destino, sabores y cantidades, total y link al remito.
 */
export async function mensajeWhatsAppTransferencia(ctx: Ctx, id: string): Promise<string> {
  const t = await obtenerTransferencia(ctx, id);
  const remito = t.remitoUrl ? await urlCompartible(t.remitoUrl) : null;
  return [
    `Transferencia ${t.codigo}: ${t.origen} → ${t.destino}`,
    t.estado === EstadoTransferencia.PENDIENTE ? "En camino (falta confirmar la recepción)." : "",
    "",
    ...t.items.map((i) => `• ${i.cantidad} × ${i.nombre}`),
    "",
    `Total: ${t.unidades} unidades`,
    ...(t.observacion ? [`Obs.: ${t.observacion}`] : []),
    ...(remito ? [`Remito: ${remito}`] : []),
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim();
}

// =============================================================================
// Remito PDF
// =============================================================================

/**
 * Remito de la transferencia (A4): logo del panel, código, fecha, origen →
 * destino, usuario, tabla con marca, modelo, especificación (pitadas), sabor
 * y cantidad, total de unidades, observación y dos líneas de firma (Entrega /
 * Recibe). Se guarda en el storage y queda en `remitoUrl`.
 * Todo texto pasa por aWinAnsi antes de medirlo o dibujarlo.
 */
export async function generarRemito(ctx: Ctx, id: string): Promise<{ url: string }> {
  const db = dbPara(ctx.panelId);
  const [t, panel, negocio] = await Promise.all([
    obtenerTransferencia(ctx, id),
    db.panel.findUniqueOrThrow({
      where: { id: ctx.panelId },
      select: { nombre: true, slug: true, logoUrl: true, etiquetaEspecificacion: true },
    }),
    nombreNegocio(),
  ]);
  const bytes = await dibujarRemito(t, panel, negocio);
  const url = await obtenerStorage().guardar(
    claveAleatoria("remitos", t.codigo, "pdf"),
    bytes,
    "application/pdf",
  );
  // remitoUrl no está congelado por el trigger de estado: se puede guardar en cualquier estado.
  await db.transferencia.update({ where: { id }, data: { remitoUrl: url } });
  return { url };
}

async function dibujarRemito(
  t: TransferenciaDetalle,
  panel: { nombre: string; slug: string; logoUrl: string | null; etiquetaEspecificacion: string },
  negocio: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Remito ${t.codigo}`);
  doc.setCreator(negocio);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  let logo: PDFImage | null = null;
  for (const url of logosCandidatos(panel.slug, panel.logoUrl)) {
    logo = await cargarLogoPdf(doc, url);
    if (logo) break;
  }

  const ANCHO = 595.28;
  const ALTO = 841.89;
  const M = 40;
  const util = ANCHO - 2 * M;
  const negro = COLOR_PDF.texto;
  const gris = COLOR_PDF.muted;
  const grisClaro = COLOR_PDF.subtle;
  const fondo = COLOR_PDF.card;
  const linea = COLOR_PDF.borde;
  const PIE = 44;
  let page: PDFPage = doc.addPage([ANCHO, ALTO]);
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
  const raya = (yy: number, grosor = 0.4, color = linea) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: ANCHO - M, y: yy },
      thickness: grosor,
      color,
    });

  // Cabecera: logo del panel a la izquierda, negocio a la derecha.
  const ALTO_CAB = 48;
  if (logo) {
    const escala = Math.min(170 / logo.width, ALTO_CAB / logo.height);
    page.drawImage(logo, {
      x: M,
      y: y - ALTO_CAB + (ALTO_CAB - logo.height * escala) / 2,
      width: logo.width * escala,
      height: logo.height * escala,
    });
  } else {
    texto(panel.nombre, M, y - 30, { size: 20, font: negrita });
  }
  texto(negocio, ANCHO - M, y - 14, { size: 11, font: negrita, derecha: true });
  texto(panel.nombre, ANCHO - M, y - 28, { size: 9, color: gris, derecha: true });
  y -= ALTO_CAB + 16;
  raya(y, 0.6);
  y -= 34;

  texto("Remito de transferencia", M, y, { size: 20, font: negrita });
  texto(t.codigo, ANCHO - M, y, { size: 14, font: mono, derecha: true });
  y -= 22;

  // Banda de datos: fecha, origen, destino y usuario.
  const altoDatos = 44;
  rectRedondeado(page, M, y - altoDatos, util, altoDatos, 6, fondo);
  const col = util / 4;
  const celda = (i: number, etiqueta: string, valor: string, fuerte = false) => {
    texto(etiqueta, M + 12 + i * col, y - 16, { size: 7.5, color: gris });
    texto(valor, M + 12 + i * col, y - 31, {
      size: 10,
      font: fuerte ? negrita : normal,
      max: col - 20,
    });
  };
  celda(0, "Fecha", formatearFechaHora(t.fecha));
  celda(1, "Origen", t.origen, true);
  celda(2, "Destino", t.destino, true);
  celda(3, "Preparó", t.usuario);
  y -= altoDatos + 26;

  // Tabla: marca, modelo, especificación, sabor, cantidad.
  const anchos = { marca: 110, modelo: 120, espec: 70, cant: 60 };
  const anchoSabor = util - anchos.marca - anchos.modelo - anchos.espec - anchos.cant;
  const xMarca = M + 10;
  const xModelo = M + anchos.marca;
  const xEspec = xModelo + anchos.modelo;
  const xSabor = xEspec + anchos.espec;
  const xCant = ANCHO - M - 10;
  const encabezado = () => {
    rectRedondeado(page, M, y - 7, util, 22, 4, fondo);
    const o = { font: negrita, size: 8, color: gris };
    texto("Marca", xMarca, y, o);
    texto("Modelo", xModelo, y, o);
    texto(panel.etiquetaEspecificacion || "Especificación", xEspec, y, {
      ...o,
      max: anchos.espec - 8,
    });
    texto("Sabor", xSabor, y, o);
    texto("Cantidad", xCant, y, { ...o, derecha: true });
    y -= 26;
  };
  const nuevaPagina = () => {
    page = doc.addPage([ANCHO, ALTO]);
    y = ALTO - M;
    texto(`${t.codigo} (continuación)`, M, y, { color: gris, font: negrita });
    y -= 10;
    raya(y, 0.6);
    y -= 22;
  };
  encabezado();
  for (const i of t.items) {
    if (y < M + PIE + 10) {
      nuevaPagina();
      encabezado();
    }
    texto(i.marca, xMarca, y, { size: 9.5, max: anchos.marca - 16 });
    texto(i.modelo, xModelo, y, { size: 9.5, max: anchos.modelo - 8 });
    texto(i.especificacion || "—", xEspec, y, { size: 9.5, max: anchos.espec - 8 });
    texto(i.sabor ?? "—", xSabor, y, { size: 9.5, max: anchoSabor - 12 });
    texto(String(i.cantidad), xCant, y, { size: 9.5, font: negrita, derecha: true });
    y -= 8;
    raya(y, 0.4);
    y -= 15;
  }

  // Total de unidades.
  if (y < M + PIE + 40) nuevaPagina();
  y -= 4;
  page.drawLine({
    start: { x: xSabor, y: y + 1 },
    end: { x: ANCHO - M, y: y + 1 },
    thickness: 0.8,
    color: negro,
  });
  y -= 18;
  texto("Total de unidades", xCant - 60, y, { font: negrita, size: 12, derecha: true });
  texto(String(t.unidades), xCant, y, { font: negrita, size: 14, derecha: true });
  y -= 34;

  if (t.observacion) {
    if (y < M + PIE + 30) nuevaPagina();
    texto("Observación", M, y, { font: negrita, size: 10 });
    y -= 15;
    for (const l of t.observacion.split("\n"))
      for (const lin of envolver(aWinAnsi(l, normal), normal, 9, util)) {
        if (y < M + PIE) nuevaPagina();
        texto(lin, M, y, { color: gris });
        y -= 13;
      }
    y -= 10;
  }

  // Firmas: Entrega (origen) y Recibe (destino).
  const ALTO_FIRMAS = 80;
  if (y < M + PIE + ALTO_FIRMAS) nuevaPagina();
  y -= 50;
  const anchoFirma = (util - 40) / 2;
  const firma = (x: number, titulo: string, lugar: string) => {
    page.drawLine({
      start: { x, y },
      end: { x: x + anchoFirma, y },
      thickness: 0.8,
      color: negro,
    });
    texto(titulo, x, y - 13, { font: negrita, size: 9.5 });
    texto(`Firma y aclaración · ${lugar}`, x, y - 26, {
      size: 8,
      color: gris,
      max: anchoFirma,
    });
  };
  firma(M, "Entrega", t.origen);
  firma(M + anchoFirma + 40, "Recibe", t.destino);

  // Pie de cada página: código y página.
  const paginas = doc.getPages();
  paginas.forEach((p, n) => {
    p.drawLine({
      start: { x: M, y: M + 4 },
      end: { x: ANCHO - M, y: M + 4 },
      thickness: 0.4,
      color: linea,
    });
    const s = aWinAnsi(`${t.codigo} · Página ${n + 1} de ${paginas.length}`, normal);
    p.drawText(s, {
      x: ANCHO - M - normal.widthOfTextAtSize(s, 7.5),
      y: M - 8,
      size: 7.5,
      font: normal,
      color: grisClaro,
    });
  });

  return doc.save();
}
