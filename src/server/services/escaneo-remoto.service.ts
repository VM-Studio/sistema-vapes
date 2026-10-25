import { AccionAuditoria, Escaneo, EstadoVenta, Prisma, RolUsuario } from "@prisma/client";

import {
  evaluarEscaneo,
  NOMBRE_ESCANEO,
  type EvaluacionEscaneo,
  type IdentidadVape,
  type ItemEscaneo,
  type LecturaEscaneo,
} from "@/lib/escaneo-remoto";
import { ahora } from "@/lib/reloj";
import { nombreConSabor, saborVisible } from "@/lib/ventas-ui";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import { normalizarCodigo } from "@/server/services/producto.service";

/**
 * «ESCANEA CHARLY» — escaneo remoto de ventas (por panel).
 *
 * - Solo en galpones con `Deposito.escaneoRemoto` (Vapes: Mercedes). Es
 *   OPCIONAL: lo pide el vendedor (o un dueño) al generar la venta o después,
 *   mientras la venta esté confirmada, sin escanear y sin verificar con la
 *   pistola. Mientras está PENDIENTE se puede cancelar.
 * - STOCK: la venta ya descontó la variante exacta del galpón al generarse
 *   (VENTA por ítem). El escaneo NO mueve stock: confirma físicamente que lo
 *   que sale del galpón es lo vendido. Descontar recién al escanear dejaría
 *   el stock "vendible" dos veces mientras espera (y Charly es opcional).
 * - La validación es del SERVIDOR: cada código se resuelve contra el catálogo
 *   del panel y se compara con los ítems (lib/escaneo-remoto.ts). Al confirmar
 *   se vuelve a evaluar todo dentro de la transacción: solo si coincide EXACTO
 *   la venta queda ESCANEADA y `verificadaPorEscaneo`, con los códigos en
 *   `escaneoDetalle` y en AuditLog.
 * - Una venta anulada sale de la lista (solo se listan las CONFIRMADAS).
 */

const OPCIONES_TX = { maxRetries: 5, timeout: 30_000 };

export interface VentaParaEscanear {
  id: string;
  codigo: string;
  fecha: Date;
  vendedor: string;
  deposito: string;
  pedidoAt: Date;
  pedidoPor: string;
  /** Etiqueta del atributo principal del panel ("Pitadas"). */
  etiquetaEspecificacion: string;
  items: ItemEscaneo[];
}

/** Estado del escaneo remoto de una venta, para listado/detalle. */
export interface EstadoEscaneoVenta {
  estado: Escaneo | null;
  pedidoPor: string | null;
  pedidoAt: Date | null;
  escaneadaPor: string | null;
  escaneadaAt: Date | null;
}

const selectItemsEscaneo = {
  orderBy: { createdAt: "asc" },
  select: {
    varianteId: true,
    productoId: true,
    cantidad: true,
    variante: {
      select: {
        nombre: true,
        producto: {
          select: {
            nombre: true,
            especificacion: true,
            nombreCompleto: true,
            marca: { select: { nombre: true } },
          },
        },
      },
    },
  },
} satisfies Prisma.Venta$itemsArgs;

type FilaItem = Prisma.VentaItemGetPayload<{ select: (typeof selectItemsEscaneo)["select"] }>;

function aItem(i: FilaItem): ItemEscaneo {
  const p = i.variante.producto;
  return {
    varianteId: i.varianteId,
    productoId: i.productoId,
    marca: p.marca.nombre,
    modelo: p.nombre,
    especificacion: p.especificacion,
    sabor: saborVisible(i.variante.nombre),
    titulo: nombreConSabor(p.nombreCompleto, i.variante.nombre),
    cantidad: i.cantidad,
  };
}

async function etiquetaDelPanel(db: Tx, panelId: string): Promise<string> {
  const p = await db.panel.findUnique({
    where: { id: panelId },
    select: { etiquetaEspecificacion: true },
  });
  return p?.etiquetaEspecificacion || "Pitadas";
}

// =============================================================================
// Pedir / cancelar (vendedor de la venta o dueño)
// =============================================================================

async function bloquearVenta(tx: Tx, ctx: Ctx, id: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "Venta" WHERE "id" = ${id} AND "panelId" = ${ctx.panelId} FOR UPDATE
  `;
  const venta = await tx.venta.findUnique({
    where: { id },
    select: {
      id: true,
      codigo: true,
      estado: true,
      vendedorId: true,
      verificadaPorEscaneo: true,
      escaneoRemoto: true,
      deposito: { select: { nombre: true, escaneoRemoto: true } },
    },
  });
  if (!venta) throw new NotFoundError("La venta no existe");
  return venta;
}

async function assertVendedorODueno(tx: Tx, ctx: Ctx, vendedorId: string): Promise<void> {
  if (vendedorId === ctx.usuarioId) return;
  const u = await tx.usuario.findUnique({ where: { id: ctx.usuarioId }, select: { rol: true } });
  if (u?.rol !== RolUsuario.OWNER)
    throw new ForbiddenError(
      `Solo quien hizo la venta o un dueño puede pedir que la escanee ${NOMBRE_ESCANEO}.`,
    );
}

/**
 * Motivo por el que una venta NO admite pedir el escaneo (null = se puede).
 * Lo usan el servicio (validación) y la UI (mostrar u ocultar el botón).
 */
export function motivoNoEscaneable(v: {
  estado: EstadoVenta;
  verificadaPorEscaneo: boolean;
  escaneoRemoto: Escaneo | null;
  deposito: { nombre: string; escaneoRemoto: boolean };
}): string | null {
  if (!v.deposito.escaneoRemoto)
    return `El galpón ${v.deposito.nombre} no tiene escaneo remoto: «Escanea ${NOMBRE_ESCANEO}» es solo para los galpones que lo admiten.`;
  if (v.estado !== EstadoVenta.CONFIRMADA) return "La venta está anulada.";
  if (v.escaneoRemoto === Escaneo.PENDIENTE)
    return `Ya está pedido: la venta espera el escaneo de ${NOMBRE_ESCANEO}.`;
  if (v.escaneoRemoto === Escaneo.ESCANEADA) return `${NOMBRE_ESCANEO} ya la escaneó.`;
  if (v.verificadaPorEscaneo) return "La venta ya está verificada por escaneo.";
  return null;
}

export async function pedirEscaneo(ctx: Ctx, ventaId: string): Promise<{ codigo: string }> {
  return transaccion(
    ctx,
    async (tx) => {
      const v = await bloquearVenta(tx, ctx, ventaId);
      await assertVendedorODueno(tx, ctx, v.vendedorId);
      const motivo = motivoNoEscaneable(v);
      if (motivo) throw new DomainError(motivo);
      const cuando = ahora();
      await tx.venta.update({
        where: { id: ventaId },
        data: {
          escaneoRemoto: Escaneo.PENDIENTE,
          escaneoPedidoPorId: ctx.usuarioId,
          escaneoPedidoAt: cuando,
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Venta",
        entidadId: ventaId,
        datosAntes: { escaneoRemoto: null },
        datosDespues: { codigo: v.codigo, escaneoRemoto: Escaneo.PENDIENTE },
        meta: ctx.meta,
      });
      return { codigo: v.codigo };
    },
    OPCIONES_TX,
  );
}

export async function cancelarEscaneo(ctx: Ctx, ventaId: string): Promise<{ codigo: string }> {
  return transaccion(
    ctx,
    async (tx) => {
      const v = await bloquearVenta(tx, ctx, ventaId);
      await assertVendedorODueno(tx, ctx, v.vendedorId);
      if (v.escaneoRemoto !== Escaneo.PENDIENTE)
        throw new DomainError(
          v.escaneoRemoto === Escaneo.ESCANEADA
            ? `${NOMBRE_ESCANEO} ya escaneó la venta ${v.codigo}: no se puede cancelar.`
            : `La venta ${v.codigo} no tiene un escaneo pedido.`,
        );
      await tx.venta.update({
        where: { id: ventaId },
        data: { escaneoRemoto: null, escaneoPedidoPorId: null, escaneoPedidoAt: null },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Venta",
        entidadId: ventaId,
        datosAntes: { escaneoRemoto: Escaneo.PENDIENTE },
        datosDespues: { codigo: v.codigo, escaneoRemoto: null, cancelado: true },
        meta: ctx.meta,
      });
      return { codigo: v.codigo };
    },
    OPCIONES_TX,
  );
}

// =============================================================================
// Pantalla de escaneo (perfil ESCANEO)
// =============================================================================

const wherePendientes = {
  estado: EstadoVenta.CONFIRMADA,
  escaneoRemoto: Escaneo.PENDIENTE,
} satisfies Prisma.VentaWhereInput;

const selectParaEscanear = {
  id: true,
  codigo: true,
  fecha: true,
  escaneoPedidoAt: true,
  vendedor: { select: { nombre: true } },
  escaneoPedidoPor: { select: { nombre: true } },
  deposito: { select: { nombre: true } },
  items: selectItemsEscaneo,
} satisfies Prisma.VentaSelect;

type FilaParaEscanear = Prisma.VentaGetPayload<{ select: typeof selectParaEscanear }>;

function aParaEscanear(v: FilaParaEscanear, etiqueta: string): VentaParaEscanear {
  return {
    id: v.id,
    codigo: v.codigo,
    fecha: v.fecha,
    vendedor: v.vendedor.nombre,
    deposito: v.deposito.nombre,
    pedidoAt: v.escaneoPedidoAt ?? v.fecha,
    pedidoPor: v.escaneoPedidoPor?.nombre ?? v.vendedor.nombre,
    etiquetaEspecificacion: etiqueta,
    items: v.items.map(aItem),
  };
}

/** Ventas del panel que esperan el escaneo (de todos los vendedores), la más vieja primero. */
export async function listarPendientesDeEscaneo(ctx: Ctx): Promise<VentaParaEscanear[]> {
  const db = dbPara(ctx.panelId);
  const [filas, etiqueta] = await Promise.all([
    db.venta.findMany({
      where: wherePendientes,
      orderBy: [{ escaneoPedidoAt: "asc" }, { numero: "asc" }],
      take: 100,
      select: selectParaEscanear,
    }),
    etiquetaDelPanel(db, ctx.panelId),
  ]);
  return filas.map((v) => aParaEscanear(v, etiqueta));
}

/** Resuelve códigos escaneados contra el catálogo del panel (código principal o alternativo). */
async function resolverCodigos(db: Tx, codigos: readonly string[]): Promise<LecturaEscaneo[]> {
  const normalizados = codigos.map((c) => ({ crudo: c, n: normalizarCodigo(c) }));
  const validos = [...new Set(normalizados.flatMap((c) => (c.n ? [c.n] : [])))];
  const variantes = validos.length
    ? await db.variante.findMany({
        where: {
          deletedAt: null,
          producto: { deletedAt: null },
          OR: [
            { codigoBarras: { in: validos } },
            { codigosAlternativos: { some: { codigo: { in: validos } } } },
          ],
        },
        select: {
          id: true,
          nombre: true,
          productoId: true,
          codigoBarras: true,
          codigosAlternativos: { where: { codigo: { in: validos } }, select: { codigo: true } },
          producto: {
            select: {
              nombre: true,
              especificacion: true,
              nombreCompleto: true,
              marca: { select: { nombre: true } },
            },
          },
        },
      })
    : [];
  const porCodigo = new Map<string, IdentidadVape>();
  for (const v of variantes) {
    const identidad: IdentidadVape = {
      varianteId: v.id,
      productoId: v.productoId,
      marca: v.producto.marca.nombre,
      modelo: v.producto.nombre,
      especificacion: v.producto.especificacion,
      sabor: saborVisible(v.nombre),
      titulo: nombreConSabor(v.producto.nombreCompleto, v.nombre),
    };
    if (v.codigoBarras) porCodigo.set(v.codigoBarras, identidad);
    for (const a of v.codigosAlternativos) porCodigo.set(a.codigo, identidad);
  }
  return normalizados.map((c) => ({
    codigo: c.n ?? c.crudo.trim(),
    variante: c.n ? (porCodigo.get(c.n) ?? null) : null,
  }));
}

async function ventaPendiente(db: Tx, ventaId: string): Promise<FilaParaEscanear> {
  const v = await db.venta.findUnique({
    where: { id: ventaId },
    select: { ...selectParaEscanear, estado: true, escaneoRemoto: true },
  });
  if (!v) throw new NotFoundError("La venta no existe");
  if (v.estado !== EstadoVenta.CONFIRMADA)
    throw new DomainError(
      `La venta ${v.codigo} se anuló: ya no hay que escanearla.`,
      "VENTA_NO_PENDIENTE",
    );
  if (v.escaneoRemoto !== Escaneo.PENDIENTE)
    throw new DomainError(
      v.escaneoRemoto === Escaneo.ESCANEADA
        ? `La venta ${v.codigo} ya está escaneada.`
        : `Ya no piden escanear la venta ${v.codigo}.`,
      "VENTA_NO_PENDIENTE",
    );
  return v;
}

/**
 * Evalúa los códigos escaneados hasta ahora (en orden) contra la venta. La
 * pantalla manda la lista completa en cada escaneo (sin estado en el servidor)
 * y muestra lo que devuelve: progreso por ítem, rechazos con su diferencia y
 * si ya se puede confirmar.
 */
export async function evaluarCodigosEscaneo(
  ctx: Ctx,
  ventaId: string,
  codigos: readonly string[],
): Promise<EvaluacionEscaneo> {
  const db = dbPara(ctx.panelId);
  const v = await ventaPendiente(db, ventaId);
  const [lecturas, etiqueta] = await Promise.all([
    resolverCodigos(db, codigos),
    etiquetaDelPanel(db, ctx.panelId),
  ]);
  return evaluarEscaneo(v.items.map(aItem), lecturas, { etiquetaEspecificacion: etiqueta });
}

/**
 * «Vape escaneado»: vuelve a evaluar TODO en la transacción (con la venta
 * bloqueada) y, solo si coincide exacto, la marca ESCANEADA y verificada por
 * escaneo. Si algo no coincide, responde con cada diferencia (no guarda nada).
 */
export async function confirmarEscaneo(
  ctx: Ctx,
  ventaId: string,
  codigos: readonly string[],
): Promise<{ codigo: string; escaneadaAt: Date }> {
  return transaccion(
    ctx,
    async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Venta" WHERE "id" = ${ventaId} AND "panelId" = ${ctx.panelId} FOR UPDATE
      `;
      const v = await ventaPendiente(tx, ventaId);
      const lecturas = await resolverCodigos(tx, codigos);
      const r = evaluarEscaneo(v.items.map(aItem), lecturas, {
        etiquetaEspecificacion: await etiquetaDelPanel(tx, ctx.panelId),
      });
      if (!r.completo) {
        const problemas = [
          ...r.rechazos.map((x) => `${x.resumen}: ${x.detalles.join(" ")}`),
          ...r.faltantes.map((f) => f.mensaje),
        ];
        throw new DomainError(
          `Lo escaneado no coincide con la venta ${v.codigo}. ${problemas.join(" · ")}`,
          "ESCANEO_NO_COINCIDE",
          422,
          { escaneo: problemas },
        );
      }
      const cuando = ahora();
      const detalle = r.aceptados.map((a) => ({ codigo: a.codigo, varianteId: a.varianteId }));
      await tx.venta.update({
        where: { id: ventaId },
        data: {
          escaneoRemoto: Escaneo.ESCANEADA,
          escaneadaPorId: ctx.usuarioId,
          escaneadaAt: cuando,
          escaneoDetalle: detalle,
          verificadaPorEscaneo: true,
        },
      });
      await registrarAuditoria(tx, {
        usuarioId: ctx.usuarioId,
        accion: AccionAuditoria.UPDATE,
        entidad: "Venta",
        entidadId: ventaId,
        datosAntes: { escaneoRemoto: Escaneo.PENDIENTE },
        datosDespues: {
          codigo: v.codigo,
          escaneoRemoto: Escaneo.ESCANEADA,
          verificadaPorEscaneo: true,
          escaneado: detalle,
        },
        meta: ctx.meta,
      });
      return { codigo: v.codigo, escaneadaAt: cuando };
    },
    OPCIONES_TX,
  );
}

// =============================================================================
// Avisos (vendedor / dueños)
// =============================================================================

export interface AvisosEscaneo {
  /** Escaneadas en las últimas 48 h (las más nuevas primero): "listo para retirar". */
  escaneadas: {
    id: string;
    codigo: string;
    escaneadaAt: Date;
    escaneadaPor: string;
    deposito: string;
    unidades: number;
  }[];
  /** Cuántas siguen esperando el escaneo. */
  pendientes: number;
}

const HORAS_AVISO = 48;

/** Para el inicio: las ventas propias (o todas, `soloPropias: false`) que ya escaneó Charly o esperan. */
export async function avisosEscaneo(
  ctx: Ctx,
  opciones: { soloPropias: boolean },
): Promise<AvisosEscaneo> {
  const db = dbPara(ctx.panelId);
  const propias = opciones.soloPropias ? { vendedorId: ctx.usuarioId } : {};
  const desde = new Date(ahora().getTime() - HORAS_AVISO * 3600 * 1000);
  const [filas, pendientes] = await Promise.all([
    db.venta.findMany({
      where: {
        ...propias,
        estado: EstadoVenta.CONFIRMADA,
        escaneoRemoto: Escaneo.ESCANEADA,
        escaneadaAt: { gte: desde },
      },
      orderBy: { escaneadaAt: "desc" },
      take: 5,
      select: {
        id: true,
        codigo: true,
        escaneadaAt: true,
        escaneadaPor: { select: { nombre: true } },
        deposito: { select: { nombre: true } },
        items: { select: { cantidad: true } },
      },
    }),
    db.venta.count({ where: { ...propias, ...wherePendientes } }),
  ]);
  return {
    escaneadas: filas.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      escaneadaAt: v.escaneadaAt!,
      escaneadaPor: v.escaneadaPor?.nombre ?? NOMBRE_ESCANEO,
      deposito: v.deposito.nombre,
      unidades: v.items.reduce((a, i) => a + i.cantidad, 0),
    })),
    pendientes,
  };
}
